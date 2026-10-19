/**
 * Run-cycle duration that keeps feet planted: one cycle is two steps, and a step covers
 * `stepLength(speed)` metres, so cycle = 2 × step / speed. Steps lengthen with speed (a jog
 * takes short steps, a sprint long ones) and scale with the character's size.
 */
export function runCycleSec(speed: number, rigScale: number): number {
  const s = Math.max(0.3, speed);
  const step = rigScale * (0.75 + 0.85 * Math.min(1, s / 6.5));
  return Math.min(1.3, Math.max(0.36, (2 * step) / s));
}
