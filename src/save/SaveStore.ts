import { ECONOMY } from '../data/economy';
import { emptyBalances, type Balances } from '../progression/wallet';
import type { StorageBackend } from './backends';
import { CURRENT_SAVE_VERSION, SAVE_MIGRATIONS, migrate, type MigrationTable } from './migrations';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings';

export interface StageRecord {
  bestStars: number;
  bestTimeSec: number;
  clears: number;
}

export interface SaveData {
  version: number;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  wallet: Balances;
  records: Record<string, StageRecord>;
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
    wallet: { ...emptyBalances(), gems: ECONOMY.startingGems },
    records: {},
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.min(ECONOMY.maxBalance, Math.floor(v))
    : 0;
}

function sanitizeWallet(raw: unknown): Balances {
  const out = emptyBalances();
  if (!isRecord(raw)) return out;
  for (const k of Object.keys(out) as (keyof Balances)[]) out[k] = count(raw[k]);
  return out;
}

function sanitizeRecords(raw: unknown): Record<string, StageRecord> {
  const out: Record<string, StageRecord> = {};
  if (!isRecord(raw)) return out;
  for (const [id, r] of Object.entries(raw)) {
    if (!isRecord(r)) continue;
    out[id] = {
      bestStars: Math.min(3, count(r['bestStars'])),
      bestTimeSec:
        typeof r['bestTimeSec'] === 'number' && r['bestTimeSec'] > 0 ? r['bestTimeSec'] : 0,
      clears: count(r['clears']),
    };
  }
  return out;
}

/** Validates a migrated object; anything missing or wrong falls back to defaults. */
export function normalizeSave(raw: Record<string, unknown>): SaveData {
  const fallback = createDefaultSave();
  return {
    version: CURRENT_SAVE_VERSION,
    createdAt: typeof raw['createdAt'] === 'string' ? raw['createdAt'] : fallback.createdAt,
    updatedAt: typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : fallback.updatedAt,
    settings: sanitizeSettings(raw['settings']),
    wallet: sanitizeWallet(raw['wallet']),
    records: sanitizeRecords(raw['records']),
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
