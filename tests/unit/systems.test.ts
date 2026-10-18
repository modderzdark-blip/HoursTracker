import { describe, expect, it, vi } from 'vitest';
import { AttackTokenManager } from '../../src/ai/AttackTokens';
import type { EnemyId } from '../../src/data/enemies';
import type { StageDef } from '../../src/data/stages';
import { WaveDirector, type WaveWorld } from '../../src/modes/WaveDirector';
import { rateRun } from '../../src/progression/stars';
import { Wallet } from '../../src/progression/wallet';
import { migrate, SAVE_MIGRATIONS, CURRENT_SAVE_VERSION } from '../../src/save/migrations';
import { normalizeSave } from '../../src/save/SaveStore';

describe('AttackTokenManager', () => {
  it('only N holders at once; holders keep their token; release frees it', () => {
    const t = new AttackTokenManager(2);
    expect(t.request(1)).toBe(true);
    expect(t.request(2)).toBe(true);
    expect(t.request(3)).toBe(false);
    expect(t.request(1)).toBe(true);
    t.release(1);
    expect(t.request(3)).toBe(true);
    expect(t.holds(3)).toBe(true);
    expect(t.count).toBe(2);
  });

  it('never exceeds the max under random request/release churn', () => {
    const t = new AttackTokenManager(2);
    let s = 7;
    const rnd = (): number => {
      s = (s * 48271) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < 5000; i++) {
      const id = Math.floor(rnd() * 12);
      if (rnd() < 0.6) t.request(id);
      else t.release(id);
      expect(t.count).toBeLessThanOrEqual(2);
    }
  });

  it('setMax shrinks/grows the budget', () => {
    const t = new AttackTokenManager(1);
    t.setMax(3);
    expect([t.request(1), t.request(2), t.request(3), t.request(4)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

function fakeWorld(cap = 99): WaveWorld & {
  spawned: EnemyId[];
  alive: number;
  bossDone: boolean;
  introDone: boolean;
  victories: number;
  spies: { startBossIntro: ReturnType<typeof vi.fn>; onWaveCleared: ReturnType<typeof vi.fn> };
} {
  const startBossIntro = vi.fn();
  const onWaveCleared = vi.fn();
  return {
    spies: { startBossIntro, onWaveCleared },
    spawned: [],
    alive: 0,
    bossDone: false,
    introDone: false,
    victories: 0,
    spawnEnemy(id) {
      if (this.alive >= cap) return false;
      this.spawned.push(id);
      this.alive++;
      return true;
    },
    aliveEnemies() {
      return this.alive;
    },
    startBossIntro,
    bossIntroDone() {
      return this.introDone;
    },
    bossDefeated() {
      return this.bossDone;
    },
    onWaveStart: vi.fn(),
    onWaveCleared,
    onVictory() {
      this.victories++;
    },
  };
}

const STAGE: StageDef = {
  id: 's',
  name: 'S',
  difficulty: 'normal',
  trainingDummy: true,
  introCountdownMs: 1000,
  waves: [
    {
      spawns: [
        { enemy: 'thrall', count: 2 },
        { enemy: 'imp', count: 2 },
      ],
      spawnIntervalMs: 100,
    },
    { spawns: [{ enemy: 'brute', count: 1 }], spawnIntervalMs: 100 },
  ],
  boss: 'hollow_warden',
  stars: { maxDamageTakenFrac: 1, parTimeSec: 60 },
  interWaveMs: 500,
  rewards: { gold: 1, gems: 1 },
};

describe('WaveDirector', () => {
  it('runs countdown → waves (interleaved, timed) → boss → victory', () => {
    const w = fakeWorld();
    const d = new WaveDirector(STAGE, w);
    d.update(999);
    expect(d.phase).toBe('countdown');
    d.update(1);
    expect(d.phase).toBe('wave');
    expect(w.spawned).toEqual(['thrall']);
    d.update(100);
    d.update(100);
    d.update(100);
    expect(w.spawned).toEqual(['thrall', 'imp', 'thrall', 'imp']);
    d.update(500);
    expect(d.phase).toBe('wave'); // enemies still alive
    w.alive = 0;
    d.update(16);
    expect(d.phase).toBe('interwave');
    expect(w.spies.onWaveCleared).toHaveBeenCalledWith(0);
    d.update(500);
    expect(d.phase).toBe('wave');
    expect(d.wave).toBe(1);
    w.alive = 0;
    d.update(400);
    d.update(500);
    expect(d.phase).toBe('bossIntro');
    expect(w.spies.startBossIntro).toHaveBeenCalledOnce();
    d.update(16);
    expect(d.phase).toBe('bossIntro');
    w.introDone = true;
    d.update(16);
    expect(d.phase).toBe('boss');
    w.bossDone = true;
    d.update(16);
    expect(d.phase).toBe('victory');
    expect(w.victories).toBe(1);
    d.update(1000);
    expect(w.victories).toBe(1);
  });

  it('respects the active-enemy cap and resumes spawning later', () => {
    const w = fakeWorld(2);
    const d = new WaveDirector(STAGE, w);
    d.skipCountdown();
    for (let i = 0; i < 10; i++) d.update(100);
    expect(w.spawned.length).toBe(2);
    expect(d.pendingSpawns).toBe(2);
    w.alive = 0;
    for (let i = 0; i < 10; i++) d.update(100);
    expect(w.spawned.length).toBe(4);
  });

  it('skipToBoss jumps straight to the boss intro', () => {
    const w = fakeWorld();
    const d = new WaveDirector(STAGE, w);
    d.skipCountdown();
    d.update(1);
    d.skipToBoss();
    w.alive = 0;
    d.update(1);
    expect(d.phase).toBe('bossIntro');
  });
});

describe('Wallet (economy rules)', () => {
  it('adds and spends integers; never negative; rejects invalid amounts', () => {
    const w = new Wallet({ gems: 20 });
    expect(w.spend('gems', 10)).toBe(true);
    expect(w.spend('gems', 11)).toBe(false);
    expect(w.get('gems')).toBe(10);
    for (const bad of [-5, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(w.add('gold', bad)).toBe(false);
      expect(w.spend('gems', bad)).toBe(false);
    }
    expect(w.get('gold')).toBe(0);
  });

  it('a failed spend changes nothing; repeated spends cannot duplicate value', () => {
    const w = new Wallet({ gems: 10 });
    expect(w.spend('gems', 10)).toBe(true);
    expect(w.spend('gems', 10)).toBe(false);
    expect(w.get('gems')).toBe(0);
  });

  it('snapshot is a copy (mutating it cannot change the wallet)', () => {
    const w = new Wallet({ gold: 5 });
    const snap = w.snapshot();
    snap.gold = 999999;
    expect(w.get('gold')).toBe(5);
  });

  it('sanitises corrupt initial balances', () => {
    const w = new Wallet({ gold: -50, gems: Number.NaN, souls: 3.9 });
    expect(w.snapshot()).toMatchObject({ gold: 0, gems: 0, souls: 3 });
  });
});

describe('star rating', () => {
  const rules = { maxDamageTakenFrac: 1, parTimeSec: 300 };
  it('1 star for a clear, +1 clean (no revive, low damage), +1 under par', () => {
    expect(rateRun({ cleared: false, timeSec: 10, damageTakenFrac: 0, revives: 0 }, rules)).toBe(0);
    expect(rateRun({ cleared: true, timeSec: 400, damageTakenFrac: 2, revives: 1 }, rules)).toBe(1);
    expect(rateRun({ cleared: true, timeSec: 400, damageTakenFrac: 0.5, revives: 0 }, rules)).toBe(
      2,
    );
    expect(rateRun({ cleared: true, timeSec: 200, damageTakenFrac: 0.5, revives: 1 }, rules)).toBe(
      2,
    );
    expect(rateRun({ cleared: true, timeSec: 200, damageTakenFrac: 0.5, revives: 0 }, rules)).toBe(
      3,
    );
  });
});

describe('save migration v1 → v2', () => {
  it('adds the wallet (with the starting gems) and records to an M1 save', () => {
    const v1 = {
      version: 1,
      createdAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
      settings: { quality: 'low', fpsCap: 30 },
    };
    const migrated = migrate(v1, CURRENT_SAVE_VERSION, SAVE_MIGRATIONS);
    const save = normalizeSave(migrated);
    expect(save.version).toBe(2);
    expect(save.settings.quality).toBe('low');
    expect(save.settings.fpsCap).toBe(30);
    expect(save.wallet).toEqual({ gold: 0, gems: 20, souls: 0, materials: 0, tickets: 0 });
    expect(save.records).toEqual({});
  });

  it('normalizeSave repairs corrupt wallet/records', () => {
    const save = normalizeSave({
      version: 2,
      wallet: { gold: -3, gems: 'x', souls: 4 },
      records: { a: { bestStars: 9, clears: 2 }, b: 5 },
    });
    expect(save.wallet.gold).toBe(0);
    expect(save.wallet.gems).toBe(0);
    expect(save.wallet.souls).toBe(4);
    expect(save.records['a']).toEqual({ bestStars: 3, bestTimeSec: 0, clears: 2 });
    expect(save.records['b']).toBeUndefined();
  });
});
