import {
  CAMERA_DISTANCE_PRESETS,
  cameraPitchDeg,
  distancePresetFor,
  resolveCameraOptions,
} from '../../camera/cameraOptions';
import { CAMERA_CONFIG } from '../../data/config';
import type { QualitySetting } from '../../data/quality';
import {
  SETTING_RANGES,
  type AimRange,
  type CameraFov,
  type CameraHeight,
  type CameraSmoothing,
  type FpsCap,
  type JoystickMode,
  type ParticleDensity,
  type QualityOverride,
  type Settings,
  type VibrationStrength,
} from '../../save/settings';
import { COLORBLIND_TELEGRAPH_COLOR, DEFAULT_TELEGRAPH_COLOR } from '../../vfx/TelegraphDecals';
import { el } from '../dom';
import { iconSpan, type IconName } from '../icons';
import { Slider } from '../Slider';
import type { MenuContext, SettingsPatch } from './context';
import type { View } from './View';

export type SettingsSection = 'camera' | 'graphics' | 'controls' | 'display' | 'audio' | 'gameplay';

interface SectionDef {
  readonly id: SettingsSection;
  readonly label: string;
  readonly icon: IconName;
  readonly title: string;
  readonly blurb: string;
}

export const SETTINGS_SECTIONS: readonly SectionDef[] = [
  {
    id: 'camera',
    label: 'Camera',
    icon: 'camera',
    title: 'Camera',
    blurb: 'Where the battle camera sits and how it moves.',
  },
  {
    id: 'graphics',
    label: 'Graphics',
    icon: 'sparkle',
    title: 'Graphics',
    blurb: 'Quality, sharpness and effects. Lower settings save battery.',
  },
  {
    id: 'controls',
    label: 'Controls',
    icon: 'gamepad',
    title: 'Controls',
    blurb: 'Touch layout, joystick, aim assist and vibration.',
  },
  {
    id: 'display',
    label: 'HUD & Access',
    icon: 'eye',
    title: 'HUD & accessibility',
    blurb: 'Battle HUD and options that make the game easier to see.',
  },
  {
    id: 'audio',
    label: 'Audio',
    icon: 'note',
    title: 'Audio',
    blurb: 'Volume levels and when sound plays.',
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    icon: 'sword',
    title: 'Gameplay & system',
    blurb: 'Safety prompts, tips, and tools.',
  },
];

/** The section shown when the screen opens again (kept for the session). */
let lastSection: SettingsSection = 'camera';

type Opt<T> = { readonly value: T; readonly label: string };

const pct = (v: number): string => `${Math.round(v * 100)}%`;

const OVERRIDE_OPTS: readonly Opt<QualityOverride>[] = [
  { value: 'auto', label: 'Preset' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

/**
 * Building blocks for one settings section. Every control reads its value through a getter, so
 * after any change `sync()` refreshes all of them (presets ↔ fine sliders, reset buttons).
 */
class SettingsKit {
  private readonly syncers: (() => void)[] = [];

  constructor(
    private readonly v: View,
    private readonly ctx: MenuContext,
  ) {}

  get s(): Settings {
    return this.ctx.settings.settings;
  }

  get port(): MenuContext['settings'] {
    return this.ctx.settings;
  }

  sync(): void {
    for (const f of this.syncers) f();
  }

  onSync(f: () => void): void {
    this.syncers.push(f);
    f();
  }

  /** Change + save + refresh the controls. */
  patch(p: SettingsPatch): void {
    this.ctx.settings.update(p);
    this.sync();
  }

  group(title: string, ...rows: HTMLElement[]): HTMLElement {
    const g = el('div', 'sgroup');
    g.append(el('div', 'sgroup-title', title), ...rows);
    return g;
  }

  row(label: string, hint: string, control: HTMLElement, testid?: string): HTMLElement {
    const r = el('div', 'srow');
    if (testid !== undefined) r.dataset['testid'] = `row-${testid}`;
    const text = el('div', 'srow-text');
    text.append(el('span', 'srow-label', label));
    if (hint.length > 0) text.append(el('span', 'srow-hint', hint));
    const ctl = el('div', 'srow-ctl');
    ctl.append(control);
    r.append(text, ctl);
    return r;
  }

  choice<T extends string | number>(
    label: string,
    hint: string,
    options: readonly Opt<T>[],
    get: () => T,
    set: (value: T) => void,
    testid: string,
    enabled: () => boolean = () => true,
  ): HTMLElement {
    const seg = el('div', 'segmented');
    const items: [T, HTMLElement][] = [];
    for (const o of options) {
      const b = this.v.button(
        o.label,
        'segment',
        () => {
          if (!enabled()) return;
          this.ctx.uiTap();
          set(o.value);
          this.sync();
        },
        { testid: `${testid}-${String(o.value)}` },
      );
      items.push([o.value, b]);
      seg.append(b);
    }
    const r = this.row(label, hint, seg, testid);
    this.onSync(() => {
      const cur = get();
      const on = enabled();
      r.classList.toggle('is-disabled', !on);
      for (const [value, b] of items) b.classList.toggle('is-selected', value === cur);
    });
    return r;
  }

  toggle(
    label: string,
    hint: string,
    get: () => boolean,
    set: (on: boolean) => void,
    testid: string,
  ): HTMLElement {
    return this.choice<'on' | 'off'>(
      label,
      hint,
      [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      () => (get() ? 'on' : 'off'),
      (x) => set(x === 'on'),
      testid,
    );
  }

  slider(
    label: string,
    hint: string,
    range: { readonly min: number; readonly max: number },
    step: number,
    format: (v: number) => string,
    get: () => number,
    set: (v: number) => void,
    testid: string,
    live?: (v: number) => void,
  ): HTMLElement {
    const sl = new Slider({
      min: range.min,
      max: range.max,
      step,
      value: get(),
      format,
      label,
      testid,
      onChange: (x) => {
        set(x);
        this.sync();
      },
      ...(live !== undefined ? { onInput: live } : {}),
    });
    this.v.onDispose(() => sl.dispose());
    this.onSync(() => sl.set(get()));
    return this.row(label, hint, sl.root, testid);
  }

  action(label: string, cls: string, fn: () => void, testid: string): HTMLElement {
    return this.v.button(
      label,
      cls,
      () => {
        this.ctx.uiTap();
        fn();
      },
      { testid },
    );
  }
}

/** Settings: sections on the left, the chosen section's options (scrollable) on the right. */
export function renderSettings(ctx: MenuContext, section: SettingsSection = lastSection): void {
  lastSection = section;
  const v = ctx.shell.begin('Settings', () => ctx.nav.hub(), 'settings');
  const wrap = el('div', 'settings-screen');
  const nav = el('div', 'settings-nav');
  nav.dataset['allowScroll'] = '';
  nav.setAttribute('role', 'tablist');
  for (const sec of SETTINGS_SECTIONS) {
    const tab = v.button(
      '',
      `settings-tab${sec.id === section ? ' is-selected' : ''}`,
      () => {
        if (sec.id === section) return;
        ctx.uiTap();
        renderSettings(ctx, sec.id);
      },
      { testid: `settings-tab-${sec.id}` },
    );
    tab.setAttribute('aria-selected', String(sec.id === section));
    tab.append(
      iconSpan('settings-tab-icon', sec.icon),
      el('span', 'settings-tab-label', sec.label),
    );
    nav.append(tab);
  }
  const def = SETTINGS_SECTIONS.find((x) => x.id === section) ?? SETTINGS_SECTIONS[0];
  const content = el('div', 'settings-content');
  content.dataset['allowScroll'] = '';
  content.dataset['section'] = section;
  content.dataset['testid'] = 'settings-content';
  const head = el('div', 'settings-head');
  head.append(
    el('h3', 'settings-title', def?.title ?? ''),
    el('p', 'settings-blurb', def?.blurb ?? ''),
  );
  content.append(head);
  const kit = new SettingsKit(v, ctx);
  BUILDERS[section](kit, ctx, content);
  wrap.append(nav, content);
  v.root.append(wrap);
}

const BUILDERS: Readonly<
  Record<SettingsSection, (k: SettingsKit, ctx: MenuContext, out: HTMLElement) => void>
> = {
  camera: buildCamera,
  graphics: buildGraphics,
  controls: buildControls,
  display: buildDisplay,
  audio: buildAudio,
  gameplay: buildGameplay,
};

// ------------------------------------------------------------------------------------- camera

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, val] of Object.entries(attrs)) n.setAttribute(k, String(val));
  return n;
}

/** Side-view sketch of the camera rig (hero, camera, view cone) that follows the settings. */
function cameraPreview(k: SettingsKit): HTMLElement {
  const box = el('div', 'cam-preview');
  const W = 240;
  const H = 96;
  const ground = 88;
  // Camera on the left looking right and down at the hero (side view, metres → px).
  const heroX = 110;
  const ppm = 7;
  const pic = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cam-preview-svg' });
  pic.setAttribute('aria-hidden', 'true');
  const cone = svg('polygon', { class: 'cam-cone', points: '' });
  const sight = svg('line', { class: 'cam-sight' });
  const body = svg('g', {});
  body.append(
    svg('line', { class: 'cam-ground', x1: 0, y1: ground, x2: W, y2: ground }),
    svg('line', {
      class: 'cam-hero',
      x1: heroX,
      y1: ground,
      x2: heroX,
      y2: ground - 1.45 * ppm,
    }),
    svg('circle', { class: 'cam-hero-head', cx: heroX, cy: ground - 1.75 * ppm, r: 2.4 }),
  );
  const cam = svg('g', {});
  cam.append(
    svg('rect', { class: 'cam-body', x: -6, y: -4, width: 12, height: 8, rx: 2 }),
    svg('polygon', { class: 'cam-lens', points: '6,-3 11,-5 11,5 6,3' }),
  );
  pic.append(cone, body, sight, cam);
  const stats = el('div', 'cam-stats');
  const line = (label: string): HTMLElement => {
    const r = el('div', 'cam-stat');
    const val = el('span', 'cam-stat-val', '');
    r.append(el('span', 'cam-stat-label', label), val);
    stats.append(r);
    return val;
  };
  const dist = line('Distance');
  const height = line('Height');
  const pitch = line('Angle');
  const fov = line('View');
  box.append(pic, stats);
  k.onSync(() => {
    const o = resolveCameraOptions(k.s);
    const cx = heroX - o.distance * ppm;
    const cy = ground - o.height * ppm;
    const tx = heroX;
    const ty = ground - CAMERA_CONFIG.lookAtHeight * ppm;
    const p = (cameraPitchDeg(o) * Math.PI) / 180;
    const half = (o.fovDeg * Math.PI) / 360;
    const len = 150;
    const ray = (a: number): string =>
      `${(cx + Math.cos(a) * len).toFixed(1)},${(cy + Math.sin(a) * len).toFixed(1)}`;
    cone.setAttribute(
      'points',
      `${cx.toFixed(1)},${cy.toFixed(1)} ${ray(p - half)} ${ray(p + half)}`,
    );
    sight.setAttribute('x1', cx.toFixed(1));
    sight.setAttribute('y1', cy.toFixed(1));
    sight.setAttribute('x2', String(tx));
    sight.setAttribute('y2', ty.toFixed(1));
    cam.setAttribute(
      'transform',
      `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${((p * 180) / Math.PI).toFixed(1)})`,
    );
    dist.textContent = `${o.distance.toFixed(1)} m`;
    height.textContent = `${o.height.toFixed(1)} m`;
    pitch.textContent = `${Math.round(cameraPitchDeg(o))}°`;
    fov.textContent = `${o.fovDeg}°`;
  });
  return box;
}

function buildCamera(k: SettingsKit, _ctx: MenuContext, out: HTMLElement): void {
  const presets: Opt<number>[] = CAMERA_DISTANCE_PRESETS.map((p) => ({
    value: p.value,
    label: p.label,
  }));
  out.append(
    cameraPreview(k),
    k.group(
      'Position',
      k.choice(
        'Distance',
        'How far behind your hero the camera sits.',
        presets,
        () => distancePresetFor(k.s.cameraDistance)?.value ?? -1,
        (x) => k.patch({ cameraDistance: x }),
        'set-cam-dist',
      ),
      k.slider(
        'Fine distance',
        'Any distance between the presets.',
        SETTING_RANGES.cameraDistance,
        0.05,
        pct,
        () => k.s.cameraDistance,
        (x) => k.patch({ cameraDistance: x }),
        'set-cam-dist-fine',
      ),
      k.choice<CameraHeight>(
        'Angle',
        'Low is more cinematic; high shows more of the arena.',
        [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
        ],
        () => k.s.cameraHeight,
        (x) => k.patch({ cameraHeight: x }),
        'set-cam-height',
      ),
      k.choice<CameraFov>(
        'Field of view',
        'Wide sees more around you; narrow looks closer.',
        [
          { value: 'narrow', label: 'Narrow' },
          { value: 'normal', label: 'Normal' },
          { value: 'wide', label: 'Wide' },
        ],
        () => k.s.cameraFov,
        (x) => k.patch({ cameraFov: x }),
        'set-cam-fov',
      ),
    ),
    k.group(
      'Motion',
      k.choice<CameraSmoothing>(
        'Follow',
        'How quickly the camera catches up with your hero.',
        [
          { value: 'snappy', label: 'Snappy' },
          { value: 'normal', label: 'Normal' },
          { value: 'smooth', label: 'Smooth' },
        ],
        () => k.s.cameraSmoothing,
        (x) => k.patch({ cameraSmoothing: x }),
        'set-cam-smooth',
      ),
      k.toggle(
        'Look-ahead',
        'Leads slightly in the direction you run.',
        () => k.s.cameraLookAhead,
        (on) => k.patch({ cameraLookAhead: on }),
        'set-cam-lead',
      ),
      k.slider(
        'Screen shake',
        'Strength of the camera shake on heavy hits (0% = off).',
        SETTING_RANGES.screenShake,
        0.05,
        pct,
        () => k.s.screenShake,
        (x) => k.patch({ screenShake: x }),
        'set-shake',
      ),
    ),
  );
  const row = el('div', 'button-row settings-actions');
  row.append(
    k.action(
      'Reset camera',
      'btn',
      () => {
        k.port.resetCamera();
        k.sync();
      },
      'set-cam-reset',
    ),
  );
  out.append(row);
}

// ----------------------------------------------------------------------------------- graphics

function buildGraphics(k: SettingsKit, _ctx: MenuContext, out: HTMLElement): void {
  const active = el('span', 'srow-note', '');
  k.onSync(() => {
    active.textContent = k.port.activeQualityLabel();
  });
  const quality = k.choice<QualitySetting>(
    'Quality preset',
    'Auto measures your device in the first fight. Ultra adds ambient occlusion, soft shadows and cinematic depth of field.',
    [
      { value: 'auto', label: 'Auto' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Med' },
      { value: 'high', label: 'High' },
      { value: 'ultra', label: 'Ultra' },
    ],
    () => k.s.quality,
    (q) => k.port.setQuality(q),
    'set-quality',
  );
  quality.querySelector('.srow-text')?.append(active);
  out.append(
    k.group(
      'Rendering',
      quality,
      k.slider(
        'Resolution',
        "Share of the preset's sharpness. Lower runs smoother and cooler.",
        SETTING_RANGES.renderScale,
        0.05,
        pct,
        () => k.s.renderScale,
        (x) => k.patch({ renderScale: x }),
        'set-res-scale',
      ),
      k.choice<FpsCap>(
        'FPS cap',
        '30 saves battery; 120 or Max is smoothest on fast screens.',
        [
          { value: 30, label: '30' },
          { value: 60, label: '60' },
          { value: 120, label: '120' },
          { value: 0, label: 'Max' },
        ],
        () => k.s.fpsCap,
        (c) => k.port.setFpsCap(c),
        'set-fps',
      ),
    ),
    k.group(
      'Effects',
      k.choice<QualityOverride>(
        'Shadows',
        'Real-time shadows from the moonlight.',
        OVERRIDE_OPTS,
        () => k.s.shadows,
        (x) => k.patch({ shadows: x }),
        'set-shadows',
      ),
      k.choice<QualityOverride>(
        'Bloom',
        'Glow around fire, magic and bright hits.',
        OVERRIDE_OPTS,
        () => k.s.bloom,
        (x) => k.patch({ bloom: x }),
        'set-bloom',
      ),
      k.choice<ParticleDensity>(
        'Particles',
        'Embers, dust and hit sparks.',
        [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
        ],
        () => k.s.particleDensity,
        (x) => k.patch({ particleDensity: x }),
        'set-particles',
      ),
    ),
    k.group(
      'Performance',
      k.toggle(
        'Show FPS',
        'A small frame-rate counter at the bottom of the screen.',
        () => k.s.showFps,
        (on) => k.patch({ showFps: on }),
        'set-show-fps',
      ),
    ),
  );
}

// ----------------------------------------------------------------------------------- controls

function buildControls(k: SettingsKit, _ctx: MenuContext, out: HTMLElement): void {
  out.append(
    k.group(
      'Touch buttons',
      k.choice<'right' | 'left'>(
        'Layout',
        'Left hand puts the buttons on the left and the stick on the right.',
        [
          { value: 'right', label: 'Right hand' },
          { value: 'left', label: 'Left hand' },
        ],
        () => (k.s.leftHanded ? 'left' : 'right'),
        (x) => k.patch({ leftHanded: x === 'left' }),
        'set-hand',
      ),
      k.choice<number>(
        'Button size',
        '',
        [
          { value: 0.85, label: 'S' },
          { value: 1, label: 'M' },
          { value: 1.15, label: 'L' },
          { value: 1.3, label: 'XL' },
        ],
        () => k.s.buttonScale,
        (x) => k.patch({ buttonScale: x }),
        'set-btn-scale',
      ),
      k.slider(
        'Button opacity',
        '',
        SETTING_RANGES.buttonOpacity,
        0.02,
        pct,
        () => k.s.buttonOpacity,
        (x) => k.patch({ buttonOpacity: x }),
        'set-btn-opacity',
      ),
    ),
    k.group(
      'Joystick',
      k.choice<JoystickMode>(
        'Position',
        'Floating appears under your thumb; fixed always stays in its corner.',
        [
          { value: 'floating', label: 'Floating' },
          { value: 'fixed', label: 'Fixed' },
        ],
        () => k.s.joystickMode,
        (x) => k.patch({ joystickMode: x }),
        'set-joy-mode',
      ),
      k.slider(
        'Size',
        'How far your thumb travels for a full-speed run.',
        SETTING_RANGES.joystickScale,
        0.05,
        pct,
        () => k.s.joystickScale,
        (x) => k.patch({ joystickScale: x }),
        'set-joy-size',
      ),
      k.slider(
        'Dead zone',
        'Small thumb movements below this are ignored.',
        SETTING_RANGES.joystickDeadZone,
        0.01,
        pct,
        () => k.s.joystickDeadZone,
        (x) => k.patch({ joystickDeadZone: x }),
        'set-joy-dead',
      ),
    ),
    k.group(
      'Aim assist',
      k.toggle(
        'Auto-aim',
        'Attacks and skills turn toward the nearest enemy in front of you.',
        () => k.s.autoAim,
        (on) => k.patch({ autoAim: on }),
        'set-autoaim',
      ),
      k.choice<AimRange>(
        'Auto-aim range',
        'How far away an enemy can be picked.',
        [
          { value: 'short', label: 'Short' },
          { value: 'normal', label: 'Normal' },
          { value: 'long', label: 'Long' },
        ],
        () => k.s.autoAimRange,
        (x) => k.patch({ autoAimRange: x }),
        'set-aim-range',
        () => k.s.autoAim,
      ),
      k.toggle(
        'Attack magnetism',
        'Combo hits lunge a little farther to reach the aimed enemy.',
        () => k.s.aimMagnetism,
        (on) => k.patch({ aimMagnetism: on }),
        'set-magnet',
      ),
    ),
    k.group(
      'Vibration',
      k.toggle(
        'Vibration',
        'Short pulses on heavy hits.',
        () => k.s.vibration,
        (on) => k.patch({ vibration: on }),
        'set-vibration',
      ),
      k.choice<VibrationStrength>(
        'Strength',
        '',
        [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'strong', label: 'Strong' },
        ],
        () => k.s.vibrationStrength,
        (x) => k.patch({ vibrationStrength: x }),
        'set-vib-strength',
        () => k.s.vibration,
      ),
    ),
  );
}

// ------------------------------------------------------------------------ HUD & accessibility

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function buildDisplay(k: SettingsKit, _ctx: MenuContext, out: HTMLElement): void {
  const swatch = el('span', 'tele-swatch');
  swatch.setAttribute('aria-hidden', 'true');
  k.onSync(() => {
    swatch.style.setProperty(
      '--tele',
      hex(k.s.colorblindTelegraphs ? COLORBLIND_TELEGRAPH_COLOR : DEFAULT_TELEGRAPH_COLOR),
    );
  });
  const tele = k.toggle(
    'Colour-blind telegraphs',
    'Enemy attack warnings on the ground turn bright yellow instead of red.',
    () => k.s.colorblindTelegraphs,
    (on) => k.patch({ colorblindTelegraphs: on }),
    'set-cb-telegraph',
  );
  tele.querySelector('.srow-label')?.prepend(swatch);
  out.append(
    k.group(
      'Battle HUD',
      k.toggle(
        'Damage numbers',
        '',
        () => k.s.showDamageNumbers,
        (on) => k.patch({ showDamageNumbers: on }),
        'set-numbers',
      ),
      k.toggle(
        'Combo counter',
        'The "12 HITS" counter during combos.',
        () => k.s.showComboCounter,
        (on) => k.patch({ showComboCounter: on }),
        'set-combo',
      ),
      k.slider(
        'HUD scale',
        'Size of the health bar, boss bar and pause button (limited on very small screens).',
        SETTING_RANGES.hudScale,
        0.05,
        pct,
        () => k.s.hudScale,
        (x) => k.patch({ hudScale: x }),
        'set-hud-scale',
      ),
    ),
    k.group(
      'Accessibility',
      k.toggle(
        'Reduce flashes',
        'Softer glow and no blinking or pulsing HUD effects.',
        () => k.s.reduceFlashes,
        (on) => k.patch({ reduceFlashes: on }),
        'set-reduce-flash',
      ),
      k.toggle(
        'Larger menu text',
        'Scales up the menus, the pause screen and results.',
        () => k.s.largeMenuText,
        (on) => k.patch({ largeMenuText: on }),
        'set-large-text',
      ),
      tele,
    ),
  );
}

// -------------------------------------------------------------------------------------- audio

function buildAudio(k: SettingsKit, _ctx: MenuContext, out: HTMLElement): void {
  const volume = (
    key: 'masterVolume' | 'musicVolume' | 'sfxVolume',
    label: string,
    hint: string,
  ): HTMLElement =>
    k.slider(
      label,
      hint,
      { min: 0, max: 1 },
      0.05,
      (x) => (x === 0 ? 'Off' : pct(x)),
      () => k.s[key],
      (x) => k.patch({ [key]: x }),
      `set-${key}`,
      // Hear the change while dragging (the hub music keeps playing).
      (x) => k.port.update({ [key]: x }),
    );
  out.append(
    k.group(
      'Volume',
      volume('masterVolume', 'Master', 'Everything at once.'),
      volume('musicVolume', 'Music', ''),
      volume('sfxVolume', 'Sound effects', 'Hits, skills and enemies.'),
    ),
    k.group(
      'Behaviour',
      k.toggle(
        'UI sounds',
        'A soft click when you tap menu buttons.',
        () => k.s.uiSounds,
        (on) => k.patch({ uiSounds: on }),
        'set-ui-sounds',
      ),
      k.toggle(
        'Mute in background',
        'Silence the game while you switch to another app.',
        () => k.s.muteInBackground,
        (on) => k.patch({ muteInBackground: on }),
        'set-bg-mute',
      ),
    ),
  );
}

// ----------------------------------------------------------------------------------- gameplay

function confirmResetAll(k: SettingsKit, ctx: MenuContext): void {
  const m = ctx.shell.openModal('confirm-modal');
  const row = el('div', 'button-row');
  row.append(
    m.button(
      'Reset settings',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        k.port.resetAll();
        ctx.shell.closeModal();
        ctx.toast('All settings restored to their defaults');
        renderSettings(ctx, 'gameplay');
      },
      { testid: 'settings-reset-confirm' },
    ),
    m.button(
      'Cancel',
      'btn',
      () => {
        ctx.uiTap();
        ctx.shell.closeModal();
      },
      { testid: 'settings-reset-cancel' },
    ),
  );
  m.root.append(
    el('h2', 'panel-title', 'Reset all settings?'),
    el(
      'p',
      'panel-body',
      'Every option on this screen goes back to its default. Your heroes, gear, currencies and progress are not affected.',
    ),
    row,
  );
}

function buildGameplay(k: SettingsKit, ctx: MenuContext, out: HTMLElement): void {
  const note = el('p', 'srow-note', '');
  note.dataset['testid'] = 'settings-copy-result';
  const tools = el('div', 'button-row settings-actions');
  tools.append(
    k.action('Fullscreen', 'btn', () => k.port.fullscreen(), 'settings-fullscreen'),
    k.action(
      'Copy debug log',
      'btn btn-accent',
      () => {
        note.textContent = 'Copying…';
        k.port
          .copyLog()
          .then((ok) => {
            note.textContent = ok
              ? 'Debug log copied — paste it into your bug report.'
              : 'Copy failed — the browser blocked clipboard access.';
          })
          .catch(() => {
            note.textContent = 'Copy failed.';
          });
      },
      'settings-copy-log',
    ),
  );
  const reset = el('div', 'button-row settings-actions');
  reset.append(
    k.action(
      'Reset all settings',
      'btn btn-danger',
      () => confirmResetAll(k, ctx),
      'set-reset-all',
    ),
  );
  out.append(
    k.group(
      'Safety & tips',
      k.toggle(
        'Confirm rare salvage',
        'Ask before salvaging rare or better gear.',
        () => k.s.confirmRareSalvage,
        (on) => k.patch({ confirmRareSalvage: on }),
        'set-confirm-salvage',
      ),
      k.toggle(
        'Defeat tips',
        'Show a combat tip on the defeat screen.',
        () => k.s.showDefeatTips,
        (on) => k.patch({ showDefeatTips: on }),
        'set-defeat-tips',
      ),
    ),
    k.group(
      'System',
      k.toggle(
        'Debug overlay',
        'Frame times, draw calls and cheats (or triple-tap the top-left corner).',
        () => k.s.showDebugOverlay,
        (on) => k.port.setDebugOverlay(on),
        'set-debug',
      ),
      tools,
      note,
    ),
    k.group(
      'Reset',
      el('p', 'srow-hint sgroup-note', 'Restores every setting. Your progress is never touched.'),
      reset,
    ),
  );
}
