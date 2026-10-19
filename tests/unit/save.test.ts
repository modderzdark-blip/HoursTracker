import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDBBackend, LocalStorageBackend, MemoryBackend } from '../../src/save/backends';
import { MigrationError, migrate, type MigrationTable } from '../../src/save/migrations';
import {
  CORRUPT_BACKUP_KEY,
  SAVE_KEY,
  SaveStore,
  createDefaultSave,
} from '../../src/save/SaveStore';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/save/settings';

describe('sanitizeSettings', () => {
  it('clamps layout / accessibility options and keeps valid ones', () => {
    const s = sanitizeSettings({
      buttonScale: 9,
      buttonOpacity: 0.1,
      leftHanded: true,
      screenShake: 'x',
      showDamageNumbers: false,
    });
    expect(s.buttonScale).toBe(1.4);
    expect(s.buttonOpacity).toBe(0.4);
    expect(s.leftHanded).toBe(true);
    expect(s.screenShake).toBe(1);
    expect(s.showDamageNumbers).toBe(false);
  });

  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and repairs invalid ones', () => {
    const s = sanitizeSettings({
      quality: 'high',
      fpsCap: 45,
      masterVolume: 7,
      sfxVolume: -1,
      musicVolume: Number.NaN,
      detectedQuality: 'ultra',
      vibration: false,
    });
    expect(s.quality).toBe('high');
    expect(s.fpsCap).toBe(DEFAULT_SETTINGS.fpsCap);
    expect(s.masterVolume).toBe(1);
    expect(s.sfxVolume).toBe(0);
    expect(s.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(s.detectedQuality).toBeNull();
    expect(s.vibration).toBe(false);
  });
});

describe('migrate', () => {
  // A test-only migration chain (the shipped table is empty: v1 is the first format).
  const table: MigrationTable = {
    1: (d) => ({ ...d, gold: 0 }),
    2: (d) => ({ ...d, gold: (d['gold'] as number) + 100, renamed: d['old'] }),
  };

  it('applies each step in order and stamps the version', () => {
    const out = migrate({ version: 1, old: 'x' }, 3, table);
    expect(out).toMatchObject({ version: 3, gold: 100, renamed: 'x' });
  });

  it('is a no-op at the current version', () => {
    expect(migrate({ version: 3, a: 1 }, 3, table)).toEqual({ version: 3, a: 1 });
  });

  it('rejects future, invalid and gap versions', () => {
    expect(() => migrate({ version: 4 }, 3, table)).toThrow(MigrationError);
    expect(() => migrate({ version: 'one' }, 3, table)).toThrow(MigrationError);
    expect(() => migrate({ version: 1 }, 3, { 1: (d) => d })).toThrow(/Missing migration 2/);
  });
});

describe('SaveStore', () => {
  it('fresh store returns defaults with status fresh', async () => {
    const r = await new SaveStore(new MemoryBackend()).load();
    expect(r.status).toBe('fresh');
    expect(r.data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through save/load', async () => {
    const store = new SaveStore(new MemoryBackend());
    const data = createDefaultSave(new Date('2026-01-01T00:00:00Z'));
    data.settings.quality = 'low';
    data.settings.fpsCap = 30;
    await store.save(data, new Date('2026-02-01T00:00:00Z'));
    const r = await store.load();
    expect(r.status).toBe('loaded');
    expect(r.data.settings.quality).toBe('low');
    expect(r.data.settings.fpsCap).toBe(30);
    expect(r.data.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(r.data.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('backs up corrupt JSON instead of destroying it, and recovers', async () => {
    const backend = new MemoryBackend();
    await backend.set(SAVE_KEY, '{not json');
    const r = await new SaveStore(backend).load();
    expect(r.status).toBe('recovered');
    expect(await backend.get(CORRUPT_BACKUP_KEY)).toBe('{not json');
  });

  it('backs up a save from a newer build', async () => {
    const backend = new MemoryBackend();
    await backend.set(SAVE_KEY, JSON.stringify({ version: 99, settings: {} }));
    const r = await new SaveStore(backend).load();
    expect(r.status).toBe('recovered');
    expect(await backend.get(CORRUPT_BACKUP_KEY)).toContain('"version":99');
  });

  it('migrates an older save through the given table on load', async () => {
    const backend = new MemoryBackend();
    await backend.set(SAVE_KEY, JSON.stringify({ version: 1, prefs: { quality: 'high' } }));
    const store = new SaveStore(backend, { 1: (d) => ({ ...d, settings: d['prefs'] }) }, 2);
    const r = await store.load();
    expect(r.status).toBe('loaded');
    expect(r.data.settings.quality).toBe('high');
  });

  it('round-trips through the IndexedDB backend', async () => {
    const backend = await IndexedDBBackend.open(indexedDB, `test-${Math.random()}`);
    const store = new SaveStore(backend);
    const data = createDefaultSave();
    data.settings.showDebugOverlay = true;
    await store.save(data);
    const r = await store.load();
    expect(r.data.settings.showDebugOverlay).toBe(true);
    await backend.remove(SAVE_KEY);
    expect((await store.load()).status).toBe('fresh');
    backend.close();
  });

  it('round-trips through the localStorage backend', async () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    } as unknown as Storage;
    const store = new SaveStore(new LocalStorageBackend(storage));
    const data = createDefaultSave();
    data.settings.quality = 'medium';
    await store.save(data);
    expect([...map.keys()]).toEqual(['ashbound:save']);
    expect((await store.load()).data.settings.quality).toBe('medium');
  });
});
