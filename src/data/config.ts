/**
 * Global tunables. Logic code reads from here; nothing below is duplicated in logic files.
 * All distances are metres, all times are milliseconds unless the name says `Sec`.
 */

export const LOOP_CONFIG = {
  /** Fixed logic rate. Physics, AI and combat timing all tick at this rate. */
  logicHz: 60,
  /** Max logic steps per rendered frame before we drop time (prevents the spiral of death). */
  maxSubSteps: 5,
  /** Frame deltas above this are clamped (tab switches, debugger pauses, GC stalls). */
  maxFrameMs: 250,
} as const;

export const INPUT_CONFIG = {
  /** Inputs pressed this early are queued and executed at the next valid window. */
  bufferMs: 150,
  joystick: {
    /** Thumb travel radius in CSS px at which the stick reads full magnitude. */
    radiusPx: 64,
    /** Normalised dead zone (0..1) — below this the stick reads zero. */
    deadZone: 0.14,
    /** 1 = linear; >1 gives finer control near the centre. */
    responseExponent: 1.25,
    /** When the thumb drags past the radius, the base follows it (keeps direction changes snappy). */
    baseFollows: true,
    /** Fraction of the screen width, from the left edge, where the joystick can spawn. */
    zoneWidthFraction: 0.45,
  },
  gamepad: {
    deadZone: 0.18,
    responseExponent: 1.25,
    /** Standard Gamepad API mapping button indices. */
    buttons: {
      attack: 0,
      dodge: 1,
      skill1: 2,
      skill2: 3,
      skill3: 5,
      ultimate: 7,
      pause: 9,
    },
  },
} as const;

export const CAMERA_CONFIG = {
  fovDeg: 48,
  near: 0.1,
  far: 120,
  /** Horizontal distance behind the target. */
  distance: 5.8,
  /** Height above the target's feet. */
  height: 5.0,
  /** Orbit angle around the target (0 = camera looks toward -Z / "north"). */
  yawDeg: 0,
  /** Point on the target the camera aims at, above the feet. */
  lookAtHeight: 1.1,
  /** Higher = snappier follow. Exponential smoothing rate (1/s). */
  followSharpness: 9,
  /** Camera leads the target in its movement direction by up to this many metres. */
  lookAhead: 1.2,
  lookAheadSharpness: 3,
  /** Boss framing: shift the anchor toward the boss and pull back so both stay on screen. */
  bossFraming: {
    anchorShift: 0.35,
    maxShift: 5,
    /** Extra distance factor at `farDistance` metres between player and boss. */
    extraDistance: 0.45,
    farDistance: 14,
    sharpness: 3,
  },
  /** Blend time back to the follow camera after a cinematic. */
  cinematicBlendMs: 450,
  shake: {
    /** Trauma decays by this much per second. Shake strength = trauma². */
    decayPerSec: 1.6,
    maxOffset: 0.35,
    maxRollDeg: 2.5,
    frequencyHz: 22,
  },
} as const;

export const PHYSICS_CONFIG = {
  gravity: -28,
  /** Skin width used by the kinematic character controller. */
  controllerOffset: 0.02,
  maxSlopeClimbDeg: 46,
  minSlopeSlideDeg: 50,
  autostepMaxHeight: 0.36,
  autostepMinWidth: 0.2,
  snapToGroundDistance: 0.35,
  /** Below this Y the actor is considered fallen out of the world and respawned. */
  killPlaneY: -15,
} as const;

export const DEBUG_CONFIG = {
  /** Hidden gesture: tap the top-left corner this many times, each within the max gap of the last. */
  gestureTaps: 3,
  gestureMaxGapMs: 1000,
  gestureCornerPx: 72,
  overlayRefreshMs: 250,
  /** Frame-time samples kept for FPS/min/max stats. */
  statsWindowFrames: 120,
  logCapacity: 200,
  /** Cheats exposed in the debug overlay. */
  cheats: {
    shakeTrauma: 0.6,
    hitStopMs: 80,
    slowMoScale: 0.3,
    slowMoMs: 600,
  },
} as const;

export const AUDIO_CONFIG = {
  defaultMasterVolume: 0.8,
  defaultSfxVolume: 1.0,
  defaultMusicVolume: 0.6,
  uiClick: { frequencyHz: 520, durationMs: 45, gain: 0.12 },
} as const;

/** Character look (procedural rigs). */
export const CHARACTER_CONFIG = {
  /**
   * Multiplier on every character surface colour (linear space, capped at 1). Rig colours are
   * authored dark for mood; the lift keeps them readable under the arenas' low-key lighting.
   */
  albedoLift: 1.9,
  /** Strength of the camera-facing rim (fresnel) and how tight it is. */
  rimStrength: 0.28,
  rimPower: 4,
  /** Reflections of the character environment on metal, leather and skin. */
  envIntensity: 1,
  /**
   * Soft camera-relative key light computed in the character shader only (no scene light, so
   * the arena costs nothing extra). Keeps faces and fronts readable under top-down moonlight.
   */
  cameraFill: 0.9,
} as const;
