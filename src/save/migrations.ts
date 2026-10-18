/**
 * Save migrations. `migrations[n]` upgrades a save from version n to n+1. When the save format
 * changes: bump CURRENT_SAVE_VERSION, add a migration for the previous version, and add a test
 * with a fixture of the old format.
 */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;
export type MigrationTable = Readonly<Record<number, Migration>>;

export const CURRENT_SAVE_VERSION = 2;

/**
 * Starting grant as it was when v2 shipped. Frozen on purpose: a migration must produce the same
 * result forever, even if data/economy.ts is retuned later.
 */
const STARTING_GEMS = 20;

export const SAVE_MIGRATIONS: MigrationTable = {
  /** v1 (M1: settings only) → v2: adds the wallet and per-stage records. */
  1: (d) => ({
    ...d,
    wallet: { gold: 0, gems: STARTING_GEMS, souls: 0, materials: 0, tickets: 0 },
    records: {},
  }),
};

export class MigrationError extends Error {}

/**
 * Upgrades `data` (which must carry a numeric `version`) to `targetVersion` by applying each
 * migration in order. Throws MigrationError if a step is missing or the save is from the future.
 */
export function migrate(
  data: Record<string, unknown>,
  targetVersion: number,
  table: MigrationTable,
): Record<string, unknown> {
  const from = data['version'];
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new MigrationError(`Invalid save version: ${String(from)}`);
  }
  if (from > targetVersion) {
    throw new MigrationError(`Save version ${from} is newer than this build (${targetVersion})`);
  }
  let current = data;
  for (let v = from; v < targetVersion; v++) {
    const step = table[v];
    if (step === undefined) throw new MigrationError(`Missing migration ${v} → ${v + 1}`);
    current = { ...step(current), version: v + 1 };
  }
  return current;
}
