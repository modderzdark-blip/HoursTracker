import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { INPUT_SOURCE, actionIndex } from '../../src/input/actions';
import { InputBuffer } from '../../src/input/InputBuffer';
import { InputState } from '../../src/input/InputState';
import { followOrigin, shapeStick } from '../../src/input/joystickMath';

describe('shapeStick', () => {
  const out = { x: 0, y: 0, magnitude: 0 };

  it('reads zero inside the dead zone', () => {
    shapeStick(5, 0, 64, 0.14, 1, out);
    expect(out.magnitude).toBe(0);
    expect(out.x).toBe(0);
  });

  it('rescales so there is no jump at the dead-zone edge', () => {
    shapeStick(64 * 0.15, 0, 64, 0.14, 1, out);
    expect(out.magnitude).toBeGreaterThan(0);
    expect(out.magnitude).toBeLessThan(0.02);
  });

  it('clamps to 1 past the radius and keeps direction', () => {
    shapeStick(300, 400, 64, 0.1, 1.3, out);
    expect(out.magnitude).toBeCloseTo(1);
    expect(out.x).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.8);
  });

  it('response exponent gives finer control near the centre', () => {
    shapeStick(32, 0, 64, 0, 2, out);
    expect(out.magnitude).toBeCloseTo(0.25);
  });
});

describe('followOrigin', () => {
  it('keeps the origin when inside the radius', () => {
    const o = followOrigin(0, 0, 10, 0, 64, new Float64Array(2));
    expect([o[0], o[1]]).toEqual([0, 0]);
  });
  it('drags the origin so the thumb stays exactly one radius away', () => {
    const o = followOrigin(0, 0, 100, 0, 64, new Float64Array(2));
    expect(o[0]).toBeCloseTo(36);
    expect(o[1]).toBeCloseTo(0);
  });
});

describe('InputBuffer', () => {
  it('a press is consumable within the window and only once', () => {
    const b = new InputBuffer(4, 150);
    b.push(0, 1000);
    expect(b.consume(0, 1100)).toBe(true);
    expect(b.consume(0, 1100)).toBe(false);
  });

  it('a press older than the window expires', () => {
    const b = new InputBuffer(4, 150);
    b.push(1, 1000);
    expect(b.has(1, 1151)).toBe(false);
    expect(b.consume(1, 1151)).toBe(false);
  });

  it('the boundary (exactly windowMs) still counts', () => {
    const b = new InputBuffer(4, 150);
    b.push(2, 0);
    expect(b.consume(2, 150)).toBe(true);
  });

  it('a newer press replaces an older one', () => {
    const b = new InputBuffer(4, 150);
    b.push(0, 0);
    b.push(0, 140);
    expect(b.consume(0, 250)).toBe(true);
  });

  it('actions are independent', () => {
    const b = new InputBuffer(4, 150);
    b.push(0, 0);
    expect(b.consume(1, 10)).toBe(false);
    expect(b.consume(0, 10)).toBe(true);
  });
});

describe('InputState', () => {
  function make(): { s: InputState; clock: { t: number }; bus: EventBus<GameEvents> } {
    const clock = { t: 0 };
    const bus = new EventBus<GameEvents>();
    return { s: new InputState(150, () => clock.t, bus), clock, bus };
  }

  it('one source releasing does not release another source holding the same action', () => {
    const { s } = make();
    s.press('attack', INPUT_SOURCE.touch);
    s.press('attack', INPUT_SOURCE.keyboard);
    s.release('attack', INPUT_SOURCE.keyboard);
    expect(s.isHeld('attack')).toBe(true);
    s.release('attack', INPUT_SOURCE.touch);
    expect(s.isHeld('attack')).toBe(false);
  });

  it('only the first press edge is buffered and counted', () => {
    const { s, bus } = make();
    let events = 0;
    bus.on('input:pressed', () => events++);
    s.press('dodge', INPUT_SOURCE.touch);
    s.press('dodge', INPUT_SOURCE.gamepad);
    expect(events).toBe(1);
    expect(s.pressCount('dodge')).toBe(1);
  });

  it('buffer uses the game clock: an early press fires at the next window inside 150 ms', () => {
    const { s, clock } = make();
    clock.t = 1000;
    s.press('attack', INPUT_SOURCE.touch);
    s.release('attack', INPUT_SOURCE.touch);
    clock.t = 1120; // e.g. the previous swing's cancel window opens 120 ms later
    expect(s.consume('attack')).toBe(true);
    s.press('attack', INPUT_SOURCE.touch);
    clock.t = 1300; // too late
    expect(s.consume('attack')).toBe(false);
  });

  it('readMove picks the strongest source and clamps to unit length', () => {
    const { s } = make();
    const out = { x: 0, y: 0 };
    s.setMove(INPUT_SOURCE.gamepad, 0.1, 0);
    s.setMove(INPUT_SOURCE.touch, 0, 0.8);
    expect(s.readMove(out)).toEqual({ x: 0, y: expect.closeTo(0.8) as number });
    s.setMove(INPUT_SOURCE.keyboard, 1, 1);
    s.readMove(out);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1);
  });

  it('releaseAll clears held actions, movement and the buffer (no stuck input)', () => {
    const { s } = make();
    s.press('attack', INPUT_SOURCE.touch);
    s.press('skill1', INPUT_SOURCE.keyboard);
    s.setMove(INPUT_SOURCE.touch, 1, 0);
    s.releaseAll();
    expect(s.isHeld('attack')).toBe(false);
    expect(s.isHeld('skill1')).toBe(false);
    expect(s.readMove({ x: 9, y: 9 })).toEqual({ x: 0, y: 0 });
    expect(s.consume('attack')).toBe(false);
    expect(s.buffer.has(actionIndex('skill1'), 0)).toBe(false);
  });
});
