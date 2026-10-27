import type { Stingers } from '../audio/Stingers';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { KillChain, multiKillWord, STREAK_MILESTONES, streakWord } from '../progression/feel';
import type { BattleCallouts, BossCard, ChapterCard } from '../ui/BattleCallouts';
import type { BattleHud } from '../ui/BattleHud';

/** HP fraction under which the heartbeat starts. */
const LOW_HP = 0.3;
/** Extra freeze on a killing blow (ms), and on a heavy killing blow. */
const FINISHER_STOP_MS = 55;
const HEAVY_FINISHER_STOP_MS = 85;
const RUMBLE_MAX = 4;

export interface FeelDeps {
  readonly bus: EventBus<GameEvents>;
  readonly hud: BattleHud;
  readonly callouts: BattleCallouts;
  readonly stingers: Stingers;
  /** Settings → Reduce flashes (read live). */
  readonly reduceFlashes: () => boolean;
  readonly vibrate: (ms: number) => void;
}

/**
 * The emotional layer of a battle — combo ranks, multi-kills, kill streaks, finisher hit-stop,
 * the low-HP heartbeat, ultimate-ready and ultimate bursts, wave / phase / boss / victory
 * moments — turned into callouts, stingers, camera rumble and time effects. Driven by
 * BattleMode; allocation-free per frame.
 */
export class BattleFeel {
  private readonly kills = new KillChain();
  private heartbeatMs = 0;
  private ultReady = false;
  /** Pending camera rumbles (real-time countdowns, ms) and their strength. */
  private readonly rumbleAt = new Float32Array(RUMBLE_MAX);
  private readonly rumbleTrauma = new Float32Array(RUMBLE_MAX);
  private lowHp = false;

  constructor(private readonly d: FeelDeps) {}

  reset(): void {
    this.kills.reset();
    this.heartbeatMs = 0;
    this.ultReady = false;
    this.lowHp = false;
    this.rumbleAt.fill(0);
    this.rumbleTrauma.fill(0);
    this.d.callouts.reset();
  }

  // ------------------------------------------------------------------ combat

  /** A hit the hero landed on an enemy. `rankUp` is the combo rank just reached, or -1. */
  hitLanded(rankUp: number): void {
    if (rankUp >= 0) this.d.stingers.play('comboRank', rankUp, 0.8);
  }

  /** An enemy died to the hero (`nowMs` = game time). `heavy` = big hit / stagger. */
  enemyKilled(nowMs: number, heavy: boolean): void {
    this.d.bus.emit('time:hitStop', { ms: heavy ? HEAVY_FINISHER_STOP_MS : FINISHER_STOP_MS });
    const r = this.kills.kill(nowMs);
    const streak = streakWord(r.streak);
    if (streak.length > 0) {
      const tier = 1 + STREAK_MILESTONES.findIndex((m) => m.kills === r.streak);
      this.d.callouts.showKill(streak, tier);
      this.d.stingers.play('callout', 4 + tier);
      return;
    }
    const multi = multiKillWord(r.multi);
    if (multi.length > 0) {
      this.d.callouts.showKill(multi, Math.min(3, r.multi - 2));
      this.d.stingers.play('callout', r.multi);
      this.d.vibrate(25);
    }
  }

  playerHurt(): void {
    this.kills.hurt();
  }

  /** Ultimate charge changed (0..1): the moment it fills, it announces itself. */
  ultimateCharge(value: number): void {
    const ready = value >= 1;
    if (ready && !this.ultReady) this.d.stingers.play('ultReady');
    this.ultReady = ready;
  }

  /** The hero unleashed the ultimate: radial burst, its name, a stinger. */
  ultimate(name: string, color: string): void {
    this.ultReady = false;
    this.d.stingers.play('ultBurst');
    if (!this.d.reduceFlashes()) this.d.callouts.ultBurst(color);
    this.d.callouts.showTitle(name.toUpperCase(), '', 'ult', 1300);
  }

  // ------------------------------------------------------------------ stage flow

  waveStart(wave: number, total: number): void {
    if (total > 1 && wave === total - 1) {
      this.d.hud.showBanner('FINAL WAVE', 'warn', 1700);
      this.d.stingers.play('finalWave');
    } else {
      this.d.hud.showBanner(`WAVE ${wave + 1} / ${total}`, 'wave', 1500);
    }
  }

  /** `bossNext` = the last wave fell and a boss is coming. */
  waveCleared(last: boolean, bossNext: boolean): void {
    if (last && bossNext) {
      this.d.hud.showBanner('THE GROUND TREMBLES…', 'warn', 1800);
      this.rumble(0, 0.25);
      this.rumble(700, 0.35);
      this.d.stingers.play('finalWave', 0, 0.7);
      return;
    }
    if (!last) {
      this.d.hud.showBanner('WAVE CLEARED', 'perfect', 1100);
      this.d.stingers.play('waveClear');
    }
  }

  chapterIntro(card: ChapterCard): void {
    this.d.callouts.showChapter(card);
    this.d.stingers.play('chapter', 0, 0.8);
  }

  /**
   * The stage opens with the camera fly-over: letterbox and the stage name (null when the chapter
   * card already titles the stage). Tap or any input skips.
   */
  stageIntro(label: string | null, ms: number): void {
    this.d.callouts.letterbox(true);
    this.d.callouts.setSkippable(true);
    if (label !== null) this.d.callouts.showTitle(label.toUpperCase(), '', 'stage', ms);
    this.d.stingers.play('whoosh', 0, 0.6);
  }

  stageIntroEnd(): void {
    this.d.callouts.letterbox(false);
    this.d.callouts.setSkippable(false);
  }

  /** The hero lands / draws their weapon at the end of the fly-over. */
  heroEntrance(): void {
    this.rumble(0, 0.22);
    this.d.vibrate(25);
  }

  /** Wave start beat: a low rumble as the enemies pour in (stronger for the final wave). */
  waveBeat(final: boolean): void {
    this.rumble(0, final ? 0.3 : 0.14);
  }

  /** A kill cam (elite / last enemy of a wave): a beat of slow motion. */
  killCam(slowScale: number, slowMs: number): void {
    this.d.bus.emit('time:slowMotion', { scale: slowScale, ms: slowMs });
    this.d.vibrate(30);
  }

  /** The boss (or rival) dies: letterbox, a white-gold flash (unless Reduce flashes), rumble. */
  bossDeath(flash: () => void): void {
    if (!this.d.reduceFlashes()) flash();
    this.d.callouts.letterbox(true);
    this.d.callouts.setSkippable(true);
    this.rumble(0, 0.5);
    this.rumble(380, 0.4);
    this.d.vibrate(90);
  }

  /** The boss intro begins: letterbox, name card, sting, ground rumble, slow motion. */
  bossIntro(card: BossCard, introMs: number): void {
    this.d.callouts.showBoss(card, introMs);
    this.d.callouts.setSkippable(true);
    this.d.stingers.play('bossSting');
    this.d.bus.emit('time:slowMotion', { scale: 0.55, ms: introMs });
    this.rumble(0, 0.3);
    this.rumble(introMs * 0.18, 0.55);
    this.rumble(introMs * 0.45, 0.4);
    this.d.vibrate(80);
  }

  bossIntroEnd(): void {
    this.d.callouts.hideBoss();
    this.d.callouts.setSkippable(false);
    // Cancel any remaining intro slow motion (a skipped intro must not linger in slow-mo).
    this.d.bus.emit('time:slowMotion', { scale: 1, ms: 0 });
    for (let i = 0; i < RUMBLE_MAX; i++) this.rumbleAt[i] = 0;
  }

  /** A boss phase change: flash, roar, banner, a beat of slow motion. */
  bossPhase(bossName: string, label: string, flash: () => void): void {
    if (!this.d.reduceFlashes()) flash();
    this.d.stingers.play('phase');
    this.d.bus.emit('camera:shake', { trauma: 0.6 });
    this.d.bus.emit('time:slowMotion', { scale: 0.35, ms: 550 });
    this.d.callouts.showTitle(`PHASE ${label}`, `${bossName} rises in fury`, 'phase', 1900);
    this.d.vibrate(60);
  }

  /** Boss down: its last words under the banner. */
  bossFell(name: string, line: string): void {
    this.d.callouts.showTitle(`${name.toUpperCase()} FALLS`, `“${line}”`, 'phase', 2600);
  }

  /** The battle is won: letterbox, VICTORY with shine, fanfare. */
  victory(delayMs: number): void {
    this.d.callouts.letterbox(true);
    this.d.callouts.setLowHp(false, 900);
    this.lowHp = false;
    window.setTimeout(() => {
      this.d.callouts.showTitle('VICTORY', '', 'victory', 2600);
      this.d.stingers.play('fanfare');
    }, delayMs);
  }

  // ------------------------------------------------------------------ frame

  /** Real-time tick: heartbeat, rumbles. */
  update(realDtSec: number, hpFrac: number, alive: boolean): void {
    const ms = realDtSec * 1000;
    const low = alive && hpFrac > 0 && hpFrac < LOW_HP;
    // Faster heartbeat the closer to death.
    const beat = 520 + 520 * Math.min(1, hpFrac / LOW_HP);
    if (low !== this.lowHp) {
      this.lowHp = low;
      this.heartbeatMs = 0;
    }
    this.d.callouts.setLowHp(low, Math.round(beat / 20) * 20);
    if (low) {
      this.heartbeatMs -= ms;
      if (this.heartbeatMs <= 0) {
        this.heartbeatMs = beat;
        this.d.stingers.play('heartbeat', 0, 0.9);
      }
    }
    for (let i = 0; i < RUMBLE_MAX; i++) {
      const at = this.rumbleAt[i] ?? 0;
      if (at <= 0) continue;
      const left = at - ms;
      this.rumbleAt[i] = left;
      if (left <= 0) {
        this.rumbleAt[i] = 0;
        this.d.bus.emit('camera:shake', { trauma: this.rumbleTrauma[i] ?? 0 });
      }
    }
  }

  /** Schedules a camera rumble after `afterMs` (real time). */
  private rumble(afterMs: number, trauma: number): void {
    if (afterMs <= 0) {
      this.d.bus.emit('camera:shake', { trauma });
      return;
    }
    for (let i = 0; i < RUMBLE_MAX; i++) {
      if ((this.rumbleAt[i] ?? 0) > 0) continue;
      this.rumbleAt[i] = afterMs;
      this.rumbleTrauma[i] = trauma;
      return;
    }
  }
}
