import type { DifficultyId } from '../../data/difficulty';
import type { HeroId } from '../../data/heroes';
import type { GearSlot } from '../../data/items';
import type { ModeId } from '../../data/modes';
import type { QualitySetting } from '../../data/quality';
import type { ArenaOpponent, ChallengeBoss } from '../../modes/meta';
import type { PlayerProfile } from '../../progression/PlayerProfile';
import type { FpsCap, Settings } from '../../save/settings';
import type { MenuShell } from './MenuShell';

/** Navigation between menu screens. */
export interface MenuNav {
  hub(): void;
  stageMap(chapter?: number): void;
  heroes(): void;
  gear(slot?: GearSlot | null): void;
  skills(): void;
  settings(): void;
  mode(id: ModeId): void;
}

/** Actions that leave the menus (start a battle). */
export interface MenuActions {
  startAdventure(stageId: string, difficulty: DifficultyId): void;
  /** False when no dungeon entry is left. */
  startDungeon(difficulty: DifficultyId): boolean;
  startTower(floor: number): void;
  startChallenge(entry: ChallengeBoss, tier: number): void;
  startArena(opponent: ArenaOpponent): void;
}

/** What every screen renderer receives. */
export interface MenuContext {
  readonly shell: MenuShell;
  readonly profile: PlayerProfile;
  readonly nav: MenuNav;
  readonly actions: MenuActions;
  readonly uiTap: () => void;
  readonly toast: (text: string) => void;
  /** Called when the selected hero changes (hub preview). */
  readonly onHeroChanged: (id: HeroId) => void;
  readonly settings: SettingsPort;
}

/** Settings the settings screen can change (implemented by the App). */
export interface SettingsPort {
  readonly settings: Settings;
  activeQualityLabel(): string;
  setQuality(q: QualitySetting): void;
  setFpsCap(cap: FpsCap): void;
  setDebugOverlay(on: boolean): void;
  setVolume(kind: 'masterVolume' | 'sfxVolume' | 'musicVolume', value: number): void;
  setVibration(on: boolean): void;
  fullscreen(): void;
  copyLog(): Promise<boolean>;
}
