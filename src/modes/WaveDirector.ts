import type { EnemyId } from '../data/enemies';
import type { StageDef } from '../data/stages';

export type StagePhase =
  'countdown' | 'wave' | 'interwave' | 'bossIntro' | 'boss' | 'victory' | 'defeat';

/** What the director needs from the world (implemented by BattleMode; faked in tests). */
export interface WaveWorld {
  /** Returns false if the enemy couldn't be spawned yet (e.g. active cap reached); retried later. */
  spawnEnemy(id: EnemyId): boolean;
  aliveEnemies(): number;
  startBossIntro(): void;
  /** True once the boss intro finished and the fight runs. */
  bossIntroDone(): boolean;
  bossDefeated(): boolean;
  onWaveStart(wave: number, total: number): void;
  onWaveCleared(wave: number): void;
  onVictory(): void;
}

/**
 * Stage flow: countdown (practice on the dummy) → waves (spawned over time, next wave when the
 * field is clear) → boss intro → boss → victory. Pure timing logic, unit-tested with a fake world.
 */
export class WaveDirector {
  phase: StagePhase = 'countdown';
  phaseMs = 0;
  wave = -1;
  private queue: EnemyId[] = [];
  private spawnTimerMs = 0;

  constructor(
    private readonly stage: StageDef,
    private readonly world: WaveWorld,
  ) {}

  get totalWaves(): number {
    return this.stage.waves.length;
  }

  get countdownRemainingMs(): number {
    return this.phase === 'countdown' ? Math.max(0, this.stage.introCountdownMs - this.phaseMs) : 0;
  }

  get pendingSpawns(): number {
    return this.queue.length;
  }

  private setPhase(p: StagePhase): void {
    this.phase = p;
    this.phaseMs = 0;
  }

  /** Skip the practice countdown. */
  skipCountdown(): void {
    if (this.phase === 'countdown') this.phaseMs = this.stage.introCountdownMs;
  }

  /** Debug: clear remaining waves and go straight to the boss. */
  skipToBoss(): void {
    this.queue.length = 0;
    this.wave = this.stage.waves.length - 1;
    this.setPhase('interwave');
    this.phaseMs = this.stage.interWaveMs;
  }

  private phaseBeforeDefeat: StagePhase = 'countdown';

  /** Freezes the flow while the defeat screen is up. */
  markDefeat(): void {
    if (this.phase === 'defeat' || this.phase === 'victory') return;
    this.phaseBeforeDefeat = this.phase;
    this.phase = 'defeat';
  }

  /** After a revive the stage continues where it stopped. */
  resumeAfterRevive(): void {
    if (this.phase === 'defeat') this.phase = this.phaseBeforeDefeat;
  }

  update(dtMs: number): void {
    this.phaseMs += dtMs;
    switch (this.phase) {
      case 'countdown':
        if (this.phaseMs >= this.stage.introCountdownMs) {
          if (this.stage.waves.length > 0) this.startWave(0);
          else this.afterWaves();
        }
        break;
      case 'wave':
        this.spawnStep(dtMs);
        if (this.queue.length === 0 && this.phaseMs > 300 && this.world.aliveEnemies() === 0) {
          this.world.onWaveCleared(this.wave);
          this.setPhase('interwave');
        }
        break;
      case 'interwave':
        if (this.phaseMs >= this.stage.interWaveMs) {
          if (this.wave + 1 < this.stage.waves.length) this.startWave(this.wave + 1);
          else this.afterWaves();
        }
        break;
      case 'bossIntro':
        if (this.world.bossIntroDone()) this.setPhase('boss');
        break;
      case 'boss':
        if (this.world.bossDefeated()) {
          this.setPhase('victory');
          this.world.onVictory();
        }
        break;
      case 'victory':
      case 'defeat':
        break;
    }
  }

  /** All waves done (or none): boss intro, duel, or victory. */
  private afterWaves(): void {
    if (this.stage.duel === true) {
      this.setPhase('boss');
    } else if (this.stage.boss !== null) {
      this.setPhase('bossIntro');
      this.world.startBossIntro();
    } else {
      this.setPhase('victory');
      this.world.onVictory();
    }
  }

  private spawnStep(dtMs: number): void {
    this.spawnTimerMs -= dtMs;
    while (this.queue.length > 0 && this.spawnTimerMs <= 0) {
      const next = this.queue[0];
      if (next === undefined || !this.world.spawnEnemy(next)) break;
      this.queue.shift();
      this.spawnTimerMs += this.stage.waves[this.wave]?.spawnIntervalMs ?? 400;
    }
    if (this.spawnTimerMs < 0) this.spawnTimerMs = 0;
  }

  private startWave(index: number): void {
    const def = this.stage.waves[index];
    if (def === undefined) return;
    this.wave = index;
    this.queue = [];
    // Interleave types so mixed waves don't arrive as clumps of one type.
    const remaining = def.spawns.map((s) => ({ id: s.enemy, left: s.count }));
    let added = true;
    while (added) {
      added = false;
      for (const r of remaining) {
        if (r.left > 0) {
          this.queue.push(r.id);
          r.left--;
          added = true;
        }
      }
    }
    this.spawnTimerMs = 0;
    this.setPhase('wave');
    this.world.onWaveStart(index, this.stage.waves.length);
    // The first enemy appears immediately.
    this.spawnStep(0);
  }
}
