import type { InputAction } from '../input/actions';
import type { QualityLevel, QualitySetting } from '../data/quality';

/** Every event that crosses module boundaries. Payloads are plain data. */
export interface GameEvents {
  'input:pressed': { readonly action: InputAction; readonly timeMs: number };
  'input:released': { readonly action: InputAction; readonly timeMs: number };
  'game:paused': { readonly paused: boolean };
  'quality:applied': { readonly level: QualityLevel; readonly setting: QualitySetting };
  'camera:shake': { readonly trauma: number };
  'time:hitStop': { readonly ms: number };
  'time:slowMotion': { readonly scale: number; readonly ms: number };
  'app:visibility': { readonly hidden: boolean };
  'player:respawned': { readonly reason: string };
  'ultimate:charge': { readonly value: number };
  'skill:used': { readonly slot: number; readonly cooldownMs: number };
}
