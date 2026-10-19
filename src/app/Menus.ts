import type { HeroId } from '../data/heroes';
import type { GearSlot } from '../data/items';
import type { ModeId } from '../data/modes';
import type { PlayerProfile } from '../progression/PlayerProfile';
import type { MenuActions, MenuContext, MenuNav, SettingsPort } from '../ui/menu/context';
import { renderGear } from '../ui/menu/gearScreen';
import { renderHeroes } from '../ui/menu/heroesScreen';
import { renderHub } from '../ui/menu/hubScreen';
import { MenuShell } from '../ui/menu/MenuShell';
import { renderSettings } from '../ui/menu/settingsScreen';
import { renderSkills } from '../ui/menu/skillsScreen';
import { renderStageMap } from '../ui/menu/stageMapScreen';

export interface MenusOptions {
  readonly uiRoot: HTMLElement;
  readonly profile: PlayerProfile;
  readonly actions: MenuActions;
  readonly settings: SettingsPort;
  readonly uiTap: () => void;
  readonly toast: (text: string) => void;
  readonly onHeroChanged: (id: HeroId) => void;
  /** Screens of the non-Adventure modes. */
  readonly modeScreens: Readonly<Record<Exclude<ModeId, 'adventure'>, (ctx: MenuContext) => void>>;
}

/** Owns the menu shell and routes between screens. */
export class Menus implements MenuNav {
  readonly shell: MenuShell;
  readonly ctx: MenuContext;
  private lastChapter = 1;

  constructor(private readonly o: MenusOptions) {
    this.shell = new MenuShell(o.uiRoot, o.profile.wallet, o.uiTap);
    this.ctx = {
      shell: this.shell,
      profile: o.profile,
      nav: this,
      actions: o.actions,
      uiTap: o.uiTap,
      toast: o.toast,
      onHeroChanged: o.onHeroChanged,
      settings: o.settings,
    };
  }

  hub(): void {
    renderHub(this.ctx);
  }

  stageMap(chapter?: number): void {
    if (chapter !== undefined) this.lastChapter = chapter;
    renderStageMap(this.ctx, this.lastChapter);
  }

  heroes(): void {
    renderHeroes(this.ctx);
  }

  gear(slot: GearSlot | null = null): void {
    renderGear(this.ctx, slot);
  }

  skills(): void {
    renderSkills(this.ctx);
  }

  settings(): void {
    renderSettings(this.ctx);
  }

  mode(id: ModeId): void {
    if (id === 'adventure') {
      this.stageMap();
      return;
    }
    this.o.modeScreens[id](this.ctx);
  }

  setVisible(visible: boolean): void {
    this.shell.setVisible(visible);
  }

  dispose(): void {
    this.shell.dispose();
  }
}
