import type { StorageBackend } from './backends';
import { CURRENT_SAVE_VERSION, SAVE_MIGRATIONS, migrate, type MigrationTable } from './migrations';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings';

export interface SaveData {
  version: number;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
}

export const SAVE_KEY = 'save';
export const CORRUPT_BACKUP_KEY = 'save.corrupt';

export function createDefaultSave(now = new Date()): SaveData {
  const iso = now.toISOString();
  return {
    version: CURRENT_SAVE_VERSION,
    createdAt: iso,
    updatedAt: iso,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Validates a migrated object; anything missing or wrong falls back to defaults. */
export function normalizeSave(raw: Record<string, unknown>): SaveData {
  const fallback = createDefaultSave();
  return {
    version: CURRENT_SAVE_VERSION,
    createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : fallback.createdAt,
    updatedAt: typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : fallback.updatedAt,
    settings: sanitizeSettings(raw['settings']),
  };
}

export interface LoadResult {
  data: SaveData;
  /** 'fresh' = nothing saved yet, 'loaded' = read fine, 'recovered' = corrupt save replaced. */
  status: 'fresh' | 'loaded' | 'recovered';
}

/**
 * Versioned JSON persistence. Corrupt or future-version saves are backed up under a separate key
 * (never silently destroyed) and replaced with defaults.
 */
export class SaveStore {
  constructor(
    readonly backend: StorageBackend,
    private readonly migrations: MigrationTable = SAVE_MIGRATIONS,
    private readonly version = CURRENT_SAVE_VERSION,
  ) {}

  async load(): Promise<LoadResult> {
    let text: string | null;
    try {
      text = await this.backend.get(SAVE_KEY);
    } catch (err) {
      console.warn('[save] read failed', err);
      return { data: createDefaultSave(), status: 'recovered' };
    }
    if (text === null) return { data: createDefaultSave(), status: 'fresh' };
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('save is not an object');
      }
      const migrated = migrate(parsed as Record<string, unknown>, this.version, this.migrations);
      return { data: normalizeSave(migrated), status: 'loaded' };
    } catch (err) {
      console.warn('[save] corrupt or incompatible save, backing up and resetting', err);
      try {
        await this.backend.set(CORRUPT_BACKUP_KEY, text);
      } catch (backupErr) {
        console.warn('[save] could not back up corrupt save', backupErr);
      }
      return { data: createDefaultSave(), status: 'recovered' };
    }
  }

  async save(data: SaveData, now = new Date()): Promise<void> {
    data.updatedAt = now.toISOString();
    data.version = this.version;
    await this.backend.set(SAVE_KEY, JSON.stringify(data));
  }
}
