import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_DISTANCE_PRESETS,
  CAMERA_FOV_DEG,
  DEFAULT_CAMERA_OPTIONS,
  cameraPitchDeg,
  distancePresetFor,
  resolveCameraOptions,
} from '../../src/camera/cameraOptions';
import { FollowCamera } from '../../src/camera/FollowCamera';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/events';
import { CAMERA_CONFIG, INPUT_CONFIG } from '../../src/data/config';
import {
  NO_QUALITY_OVERRIDES,
  QUALITY_PRESETS,
  applyQualityOverrides,
  resolvePixelRatio,
  type QualityPreset,
} from '../../src/data/quality';
import {
  AIM_RANGE_SCALE,
  DEFAULT_AIM_ASSIST,
  autoAimRangeM,
  maxExtraLungeM,
  resolveAimAssist,
} from '../../src/input/aimAssist';
import { QualityManager } from '../../src/render/QualityManager';
import {
  CAMERA_SETTING_KEYS,
  DEFAULT_SETTINGS,
  SETTING_RANGES,
  cameraDefaults,
  qualityOverridesFrom,
  resetSettings,
  sanitizeSettings,
  vibrationMs,
  type Settings,
} from '../../src/save/settings';
import { nearestStep, PAUSE_SHAKE_STEPS } from '../../src/ui/PauseMenu';
import { snapSliderValue, sliderValueAt } from '../../src/ui/Slider';
import { needsSalvageConfirm } from '../../src/ui/menu/gearScreen';
import { DEFEAT_TIPS, defeatTip } from '../../src/ui/menu/rewardScreen';
import {
  COLORBLIND_TELEGRAPH_COLOR,
  DEFAULT_TELEGRAPH_COLOR,
  isDangerColor,
  telegraphColor,
} from '../../src/vfx/TelegraphDecals';

/** Settings exactly as v0.5.0 saved them (before the settings screen grew). */
const V050_SETTINGS = {
  quality: 'medium',
  detectedQuality: 'high',
  fpsCap: 30,
  showDebugOverlay: false,
  masterVolume: 0.5,
  sfxVolume: 0.75,
  musicVolume: 0.25,
  vibration: false,
  buttonScale: 1.15,
  buttonOpacity: 0.7,
  leftHanded: true,
  screenShake: 0.5,
  showDamageNumbers: false,
};

describe('settings: defaults and migration of old saves', () => {
  it('keeps every value of a v0.5.0 save and fills the new options with defaults', () => {
    const s = sanitizeSettings(V050_SETTINGS);
    for (const [k, v] of Object.entries(V050_SETTINGS)) expect(s[k as keyof Settings]).toBe(v);
    const added = Object.keys(DEFAULT_SETTINGS).filter((k) => !(k in V050_SETTINGS));
    expect(added.length).toBeGreaterThan(20);
    for (const k of added) {
      const key = k as keyof Settings;
      expect(s[key], key).toEqual(DEFAULT_SETTINGS[key]);
    }
  });

  it('defaults keep the game exactly as it shipped', () => {
    const d = DEFAULT_SETTINGS;
    expect(resolveCameraOptions(d)).toEqual(DEFAULT_CAMERA_OPTIONS);
    expect(qualityOverridesFrom(d)).toEqual(NO_QUALITY_OVERRIDES);
    expect(resolveAimAssist(d)).toEqual(DEFAULT_AIM_ASSIST);
    expect(d.joystickDeadZone).toBe(INPUT_CONFIG.joystick.deadZone);
    expect(d.renderScale).toBe(1);
    expect(d.muteInBackground).toBe(true);
    expect(d.confirmRareSalvage).toBe(true);
  });

  it('defaults are themselves valid (sanitising them changes nothing)', () => {
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps every numeric option into its range', () => {
    const high: Record<string, number> = {};
    const low: Record<string, number> = {};
    for (const k of Object.keys(SETTING_RANGES)) {
      high[k] = 99;
      low[k] = -99;
    }
    const h = sanitizeSettings(high);
    const l = sanitizeSettings(low);
    for (const [k, r] of Object.entries(SETTING_RANGES)) {
      expect(h[k as keyof Settings], k).toBe(r.max);
      expect(l[k as keyof Settings], k).toBe(r.min);
    }
    expect(sanitizeSettings({ screenShake: 1.5 }).screenShake).toBe(1.5);
    expect(sanitizeSettings({ cameraDistance: Number.NaN }).cameraDistance).toBe(1);
    expect(sanitizeSettings({ hudScale: '1.2' }).hudScale).toBe(1);
  });

  it('repairs unknown choices and wrong types', () => {
    const s = sanitizeSettings({
      cameraHeight: 'sky',
      cameraFov: 90,
      cameraSmoothing: null,
      cameraLookAhead: 'yes',
      shadows: true,
      bloom: 'maybe',
      particleDensity: 'ultra',
      joystickMode: 'free',
      autoAimRange: 'far',
      vibrationStrength: 3,
      showFps: 1,
      reduceFlashes: 'true',
    });
    expect(s.cameraHeight).toBe('normal');
    expect(s.cameraFov).toBe('normal');
    expect(s.cameraSmoothing).toBe('normal');
    expect(s.cameraLookAhead).toBe(true);
    expect(s.shadows).toBe('auto');
    expect(s.bloom).toBe('auto');
    expect(s.particleDensity).toBe('normal');
    expect(s.joystickMode).toBe('floating');
    expect(s.autoAimRange).toBe('normal');
    expect(s.vibrationStrength).toBe('normal');
    expect(s.showFps).toBe(false);
    expect(s.reduceFlashes).toBe(false);
  });

  it('keeps valid new choices', () => {
    const s = sanitizeSettings({
      cameraHeight: 'high',
      cameraFov: 'wide',
      cameraSmoothing: 'snappy',
      cameraLookAhead: false,
      shadows: 'off',
      bloom: 'on',
      particleDensity: 'low',
      joystickMode: 'fixed',
      autoAim: false,
      autoAimRange: 'long',
      aimMagnetism: false,
      vibrationStrength: 'strong',
      uiSounds: false,
      muteInBackground: false,
      colorblindTelegraphs: true,
      largeMenuText: true,
      showComboCounter: false,
      showDefeatTips: false,
      confirmRareSalvage: false,
    });
    expect(s).toMatchObject({
      cameraHeight: 'high',
      cameraFov: 'wide',
      cameraSmoothing: 'snappy',
      cameraLookAhead: false,
      shadows: 'off',
      bloom: 'on',
      particleDensity: 'low',
      joystickMode: 'fixed',
      autoAim: false,
      autoAimRange: 'long',
      aimMagnetism: false,
      vibrationStrength: 'strong',
      uiSounds: false,
      muteInBackground: false,
      colorblindTelegraphs: true,
      largeMenuText: true,
      showComboCounter: false,
      showDefeatTips: false,
      confirmRareSalvage: false,
    });
  });

  it('reset restores every option but keeps the device benchmark result', () => {
    const changed = sanitizeSettings({
      ...V050_SETTINGS,
      cameraDistance: 1.4,
      reduceFlashes: true,
      detectedQuality: 'low',
    });
    const r = resetSettings(changed);
    expect(r).toEqual({ ...DEFAULT_SETTINGS, detectedQuality: 'low' });
  });

  it('camera reset covers exactly the camera options', () => {
    const d = cameraDefaults();
    expect(Object.keys(d).sort()).toEqual([...CAMERA_SETTING_KEYS].sort());
    for (const k of CAMERA_SETTING_KEYS) expect(d[k]).toBe(DEFAULT_SETTINGS[k]);
  });
});

describe('camera settings → follow camera parameters', () => {
  const base = cameraDefaults();

  it('distance presets scale distance and height together (same angle)', () => {
    const near = resolveCameraOptions({ ...base, cameraDistance: 0.8 });
    const far = resolveCameraOptions({ ...base, cameraDistance: 1.4 });
    expect(near.distance).toBeCloseTo(CAMERA_CONFIG.distance * 0.8);
    expect(far.distance).toBeCloseTo(CAMERA_CONFIG.distance * 1.4);
    expect(far.height).toBeCloseTo(CAMERA_CONFIG.height * 1.4);
    expect(far.height / far.distance).toBeCloseTo(near.height / near.distance);
  });

  it('angle changes only the height: low is flatter, high is steeper', () => {
    const low = resolveCameraOptions({ ...base, cameraHeight: 'low' });
    const normal = resolveCameraOptions(base);
    const high = resolveCameraOptions({ ...base, cameraHeight: 'high' });
    expect(low.distance).toBe(normal.distance);
    expect(high.distance).toBe(normal.distance);
    expect(cameraPitchDeg(low)).toBeLessThan(cameraPitchDeg(normal));
    expect(cameraPitchDeg(high)).toBeGreaterThan(cameraPitchDeg(normal));
  });

  it('field of view, follow smoothness, look-ahead and shake', () => {
    expect(resolveCameraOptions({ ...base, cameraFov: 'narrow' }).fovDeg).toBe(
      CAMERA_FOV_DEG.narrow,
    );
    expect(resolveCameraOptions({ ...base, cameraFov: 'wide' }).fovDeg).toBeGreaterThan(
      CAMERA_CONFIG.fovDeg,
    );
    const snappy = resolveCameraOptions({ ...base, cameraSmoothing: 'snappy' });
    const smooth = resolveCameraOptions({ ...base, cameraSmoothing: 'smooth' });
    expect(snappy.followSharpness).toBeGreaterThan(CAMERA_CONFIG.followSharpness);
    expect(smooth.followSharpness).toBeLessThan(CAMERA_CONFIG.followSharpness);
    expect(resolveCameraOptions({ ...base, cameraLookAhead: false }).lookAhead).toBe(0);
    expect(resolveCameraOptions({ ...base, screenShake: 0 }).shake).toBe(0);
    expect(resolveCameraOptions({ ...base, screenShake: 1.5 }).shake).toBe(1.5);
  });

  it('maps a distance value back to its preset (or none for a custom slider value)', () => {
    for (const p of CAMERA_DISTANCE_PRESETS) expect(distancePresetFor(p.value)?.id).toBe(p.id);
    expect(distancePresetFor(1.1)).toBeNull();
  });
});

describe('FollowCamera reads the live options', () => {
  const zero = new Vector3();

  function settled(cam: FollowCamera, target: Vector3): Vector3 {
    cam.snap(target);
    cam.update(target, zero, 0, 6);
    return cam.camera.position.clone().sub(target);
  }

  it('applies distance, height and FOV immediately', () => {
    const cam = new FollowCamera(16 / 9);
    const t = new Vector3(2, 0, -3);
    const before = settled(cam, t);
    expect(before.z).toBeCloseTo(CAMERA_CONFIG.distance);
    expect(before.y).toBeCloseTo(CAMERA_CONFIG.height);
    cam.setOptions(
      resolveCameraOptions({ ...cameraDefaults(), cameraDistance: 1.4, cameraFov: 'wide' }),
    );
    const after = settled(cam, t);
    expect(after.z).toBeCloseTo(CAMERA_CONFIG.distance * 1.4);
    expect(after.y).toBeCloseTo(CAMERA_CONFIG.height * 1.4);
    expect(cam.camera.fov).toBe(CAMERA_FOV_DEG.wide);
  });

  it('boss framing still pulls the camera back on top of the chosen distance', () => {
    const cam = new FollowCamera(
      16 / 9,
      resolveCameraOptions({ ...cameraDefaults(), cameraDistance: 0.8 }),
    );
    const t = new Vector3(0, 0, 0);
    // Height above the feet = chosen height × (1 + framing pull-back); the anchor shift is planar.
    const plain = settled(cam, t).y;
    cam.setFraming(new Vector3(0, 0, -10), 0.2);
    for (let i = 0; i < 300; i++) cam.update(t, zero, 1 / 60, 6);
    expect(plain).toBeCloseTo(CAMERA_CONFIG.height * 0.8);
    expect(cam.camera.position.y).toBeGreaterThan(plain * 1.3);
  });

  it('screen shake at 0% leaves the camera still; 150% shakes harder than 100%', () => {
    const offsetWith = (shake: number): number => {
      const cam = new FollowCamera(
        1,
        resolveCameraOptions({ ...cameraDefaults(), screenShake: shake }),
      );
      const t = new Vector3();
      cam.snap(t);
      const rest = cam.camera.position.clone();
      cam.shake.addTrauma(1);
      cam.update(t, zero, 1 / 60, 6);
      return cam.camera.position.distanceTo(rest);
    };
    expect(offsetWith(0)).toBe(0);
    expect(offsetWith(1.5)).toBeGreaterThan(offsetWith(1) * 1.4);
  });
});

describe('graphics overrides', () => {
  const medium: QualityPreset = QUALITY_PRESETS.medium;

  it('maps settings to overrides', () => {
    expect(qualityOverridesFrom({ shadows: 'off', bloom: 'on', particleDensity: 'high' })).toEqual({
      shadows: false,
      bloom: true,
      particleScale: 1.5,
    });
    expect(
      qualityOverridesFrom({ shadows: 'auto', bloom: 'auto', particleDensity: 'low' }),
    ).toEqual({ shadows: null, bloom: null, particleScale: 0.5 });
  });

  it('applies on top of the preset without mutating it', () => {
    const p = applyQualityOverrides(medium, { shadows: false, bloom: true, particleScale: 0.5 });
    expect(p.shadows).toBe(false);
    expect(p.bloom).toBe(true);
    expect(p.particleCount).toBe(Math.round(medium.particleCount * 0.5));
    expect(p.maxPixelRatio).toBe(medium.maxPixelRatio);
    expect(QUALITY_PRESETS.medium.shadows).toBe(true);
    expect(applyQualityOverrides(medium, NO_QUALITY_OVERRIDES)).toBe(medium);
  });

  it('QualityManager hands the overridden preset to its targets right away', () => {
    const qm = new QualityManager('medium', 'medium', new EventBus<GameEvents>());
    const seen: QualityPreset[] = [];
    qm.addTarget({ applyQuality: (p) => seen.push(p) });
    qm.setOverrides({ shadows: false, bloom: null, particleScale: 1.5 });
    expect(seen.at(-1)?.shadows).toBe(false);
    expect(seen.at(-1)?.particleCount).toBe(Math.round(medium.particleCount * 1.5));
    const n = seen.length;
    qm.setOverrides({ shadows: false, bloom: null, particleScale: 1.5 });
    expect(seen.length).toBe(n);
    qm.apply('high');
    expect(seen.at(-1)?.shadows).toBe(false);
    expect(qm.preset.bloom).toBe(true);
  });

  it('resolution scale multiplies the preset-capped pixel ratio', () => {
    expect(resolvePixelRatio(3, 2, 1)).toBe(2);
    expect(resolvePixelRatio(3, 2, 0.5)).toBe(1);
    expect(resolvePixelRatio(1, 2, 0.75)).toBe(0.75);
    expect(resolvePixelRatio(1, 1, 0.2)).toBe(0.5);
    expect(resolvePixelRatio(Number.NaN, 1.5, 1)).toBe(1);
  });
});

describe('controls', () => {
  it('auto-aim range and attack magnetism', () => {
    const on = resolveAimAssist({ autoAim: true, autoAimRange: 'long', aimMagnetism: true });
    expect(autoAimRangeM(6, on)).toBeCloseTo(6 * AIM_RANGE_SCALE.long);
    expect(maxExtraLungeM(on)).toBe(INPUT_CONFIG.aimAssist.maxExtraLungeM);
    const off = resolveAimAssist({ autoAim: false, autoAimRange: 'long', aimMagnetism: false });
    expect(autoAimRangeM(6, off)).toBe(0);
    expect(maxExtraLungeM(off)).toBe(0);
    const short = resolveAimAssist({ autoAim: true, autoAimRange: 'short', aimMagnetism: true });
    expect(autoAimRangeM(6, short)).toBeLessThan(6);
  });

  it('vibration strength scales the pulse length', () => {
    expect(vibrationMs(30, 'normal')).toBe(30);
    expect(vibrationMs(30, 'low')).toBe(15);
    expect(vibrationMs(60, 'strong')).toBeGreaterThan(60);
    expect(vibrationMs(1, 'low')).toBe(1);
  });
});

describe('UI helpers', () => {
  it('slider values snap to the step grid and the range', () => {
    expect(snapSliderValue(0.734, 0.5, 1, 0.05)).toBe(0.75);
    expect(snapSliderValue(3, 0, 1.5, 0.05)).toBe(1.5);
    expect(snapSliderValue(-1, 0.7, 1.6, 0.05)).toBe(0.7);
    expect(snapSliderValue(Number.NaN, 0.7, 1.6, 0.05)).toBe(0.7);
    expect(sliderValueAt(150, 100, 100, 0, 1, 0.05)).toBe(0.5);
    expect(sliderValueAt(0, 100, 100, 0, 1, 0.05)).toBe(0);
    expect(sliderValueAt(500, 100, 100, 0, 1, 0.05)).toBe(1);
  });

  it('pause menu highlights the nearest quick-setting step', () => {
    expect(nearestStep(1.3, PAUSE_SHAKE_STEPS)).toBe(1.5);
    expect(nearestStep(0.2, PAUSE_SHAKE_STEPS)).toBe(0);
    expect(
      nearestStep(
        1.05,
        CAMERA_DISTANCE_PRESETS.map((p) => p.value),
      ),
    ).toBe(1);
  });

  it('salvage asks first only for rare+ gear and only when the option is on', () => {
    expect(needsSalvageConfirm([{ rarity: 'common' }], true)).toBe(false);
    expect(needsSalvageConfirm([{ rarity: 'common' }, { rarity: 'rare' }], true)).toBe(true);
    expect(needsSalvageConfirm([{ rarity: 'mythic' }], false)).toBe(false);
  });

  it('defeat tips cycle through the list', () => {
    expect(defeatTip(0)).toBe(DEFEAT_TIPS[0]);
    expect(defeatTip(DEFEAT_TIPS.length + 1)).toBe(DEFEAT_TIPS[1]);
    expect(defeatTip(-1)).toBe(DEFEAT_TIPS[DEFEAT_TIPS.length - 1]);
  });

  it('colour-blind telegraphs swap red / orange danger colours only', () => {
    expect(isDangerColor(DEFAULT_TELEGRAPH_COLOR)).toBe(true);
    expect(isDangerColor(0xff7a2a)).toBe(true);
    expect(isDangerColor(0xb080ff)).toBe(false);
    expect(telegraphColor(DEFAULT_TELEGRAPH_COLOR, false)).toBe(DEFAULT_TELEGRAPH_COLOR);
    expect(telegraphColor(DEFAULT_TELEGRAPH_COLOR, true)).toBe(COLORBLIND_TELEGRAPH_COLOR);
    expect(telegraphColor(0xb080ff, true)).toBe(0xb080ff);
  });
});
