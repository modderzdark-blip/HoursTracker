import type { QualitySetting } from '../../data/quality';
import type { FpsCap } from '../../save/settings';
import { el } from '../dom';
import type { MenuContext } from './context';
import type { View } from './View';

function segmented<T extends string | number>(
  v: View,
  label: string,
  options: readonly { value: T; label: string }[],
  current: T,
  onPick: (value: T) => void,
  testid: string,
): HTMLElement {
  const row = el('div', 'setting-row');
  const seg = el('div', 'segmented');
  for (const o of options) {
    seg.append(
      v.button(
        o.label,
        `segment${o.value === current ? ' is-selected' : ''}`,
        () => onPick(o.value),
        {
          testid: `${testid}-${String(o.value)}`,
        },
      ),
    );
  }
  row.append(el('span', 'setting-label', label), seg);
  return row;
}

const VOLUMES = [
  { value: 0, label: 'Off' },
  { value: 0.25, label: '25' },
  { value: 0.5, label: '50' },
  { value: 0.75, label: '75' },
  { value: 1, label: '100' },
] as const;

function nearestVolume(v: number): number {
  let best = 0;
  for (const o of VOLUMES) if (Math.abs(o.value - v) < Math.abs(best - v)) best = o.value;
  return best;
}

/** Settings: graphics, FPS cap, audio, vibration, controls layout, accessibility, debug tools. */
export function renderSettings(ctx: MenuContext): void {
  const v = ctx.shell.begin('Settings', () => ctx.nav.hub(), 'settings');
  const s = ctx.settings;
  const st = s.settings;
  const again = (): void => renderSettings(ctx);
  const cols = el('div', 'settings');
  const a = el('div', 'settings-col');
  const b = el('div', 'settings-col');
  a.append(
    segmented<QualitySetting>(
      v,
      'Graphics',
      [
        { value: 'auto', label: 'Auto' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Med' },
        { value: 'high', label: 'High' },
      ],
      st.quality,
      (q) => {
        ctx.uiTap();
        s.setQuality(q);
        again();
      },
      'set-quality',
    ),
    el('p', 'panel-note', s.activeQualityLabel()),
    segmented<FpsCap>(
      v,
      'FPS cap',
      [
        { value: 30, label: '30' },
        { value: 60, label: '60' },
      ],
      st.fpsCap,
      (c) => {
        ctx.uiTap();
        s.setFpsCap(c);
        again();
      },
      'set-fps',
    ),
    segmented<'on' | 'off'>(
      v,
      'Vibration',
      [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      st.vibration ? 'on' : 'off',
      (x) => {
        ctx.uiTap();
        s.setVibration(x === 'on');
        again();
      },
      'set-vibration',
    ),
    segmented<'on' | 'off'>(
      v,
      'Debug overlay',
      [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      st.showDebugOverlay ? 'on' : 'off',
      (x) => {
        ctx.uiTap();
        s.setDebugOverlay(x === 'on');
        again();
      },
      'set-debug',
    ),
  );
  for (const [key, label] of [
    ['masterVolume', 'Master volume'],
    ['sfxVolume', 'Sound effects'],
    ['musicVolume', 'Music'],
  ] as const) {
    b.append(
      segmented<number>(
        v,
        label,
        VOLUMES,
        nearestVolume(st[key]),
        (x) => {
          ctx.uiTap();
          s.setVolume(key, x);
          again();
        },
        `set-${key}`,
      ),
    );
  }
  b.append(
    segmented<number>(
      v,
      'Button size',
      [
        { value: 0.85, label: 'S' },
        { value: 1, label: 'M' },
        { value: 1.15, label: 'L' },
        { value: 1.3, label: 'XL' },
      ],
      st.buttonScale,
      (x) => {
        ctx.uiTap();
        s.update({ buttonScale: x });
        again();
      },
      'set-btn-scale',
    ),
    segmented<number>(
      v,
      'Button opacity',
      [
        { value: 0.5, label: '50' },
        { value: 0.7, label: '70' },
        { value: 0.88, label: '88' },
        { value: 1, label: '100' },
      ],
      st.buttonOpacity,
      (x) => {
        ctx.uiTap();
        s.update({ buttonOpacity: x });
        again();
      },
      'set-btn-opacity',
    ),
    segmented<'on' | 'off'>(
      v,
      'Damage numbers',
      [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      st.showDamageNumbers ? 'on' : 'off',
      (x) => {
        ctx.uiTap();
        s.update({ showDamageNumbers: x === 'on' });
        again();
      },
      'set-numbers',
    ),
  );
  a.append(
    segmented<'right' | 'left'>(
      v,
      'Layout',
      [
        { value: 'right', label: 'Right hand' },
        { value: 'left', label: 'Left hand' },
      ],
      st.leftHanded ? 'left' : 'right',
      (x) => {
        ctx.uiTap();
        s.update({ leftHanded: x === 'left' });
        again();
      },
      'set-hand',
    ),
    segmented<number>(
      v,
      'Screen shake',
      [
        { value: 0, label: 'Off' },
        { value: 0.5, label: 'Half' },
        { value: 1, label: 'Full' },
      ],
      st.screenShake,
      (x) => {
        ctx.uiTap();
        s.update({ screenShake: x });
        again();
      },
      'set-shake',
    ),
  );
  const note = el('p', 'panel-note', '');
  const row = el('div', 'button-row');
  row.append(
    v.button('Fullscreen', 'btn', () => {
      ctx.uiTap();
      s.fullscreen();
    }),
    v.button(
      'Copy debug log',
      'btn btn-accent',
      () => {
        ctx.uiTap();
        note.textContent = 'Copying…';
        s.copyLog()
          .then((ok) => {
            note.textContent = ok
              ? 'Debug log copied — paste it into your bug report.'
              : 'Copy failed — the browser blocked clipboard access.';
          })
          .catch(() => {
            note.textContent = 'Copy failed.';
          });
      },
      { testid: 'settings-copy-log' },
    ),
  );
  b.append(row, note);
  cols.append(a, b);
  v.root.append(cols);
}
