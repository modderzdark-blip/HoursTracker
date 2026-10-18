/**
 * Game-time clock advanced only by fixed logic steps. Freezes during hit-stop and slows during
 * slow motion, so timing windows (input buffer, cooldowns) behave consistently with gameplay.
 */
export class GameClock {
  private ms = 0;

  get nowMs(): number {
    return this.ms;
  }

  tick(dtSec: number): void {
    this.ms += dtSec * 1000;
  }

  reset(): void {
    this.ms = 0;
  }
}
