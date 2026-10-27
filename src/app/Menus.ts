import type { Stingers } from '../audio/Stingers';
import type { HeroId } from '../data/heroes';
import type { GearSlot } from '../data/items';
import type { ModeId } from '../data/modes';
import type { PlayerProfile } from '../progression/PlayerProfile';
import type { MenuActions, MenuContext, MenuNav, SettingsPort, ShopTab } from '../ui/menu/context';
import { renderPets } from '../ui/menu/petsScreen';
import { renderRelics } from '../ui/menu/relicsScreen';
import { renderShop } from '../ui/menu/shopScreen';
import { renderGear } from '../ui/menu/gearScreen';
import { renderHeroes } from '../ui/menu/heroesScreen';
import { renderHub } from '../ui/menu/hubScreen';
import { MenuShell } from '../ui/menu/MenuShell';
import { maybeShowLoginGift, renderQuests } from '../ui/menu/questsScreen';
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
  readonly stingers: Stingers;
  readonly onHeroChanged: (id: HeroId) => void;
  readonly onPetChanged: () => void;
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
      stingers: o.stingers,
      onHeroChanged: o.onHeroChanged,
      onPetChanged: o.onPetChanged,
      settings: o.settings,
    };
  }

  hub(): void {
    renderHub(this.ctx);
    maybeShowLoginGift(this.ctx);
  }

  quests(): void {
    renderQuests(this.ctx);
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

  shop(tab: ShopTab = 'deals'): void {
    renderShop(this.ctx, tab);
  }

  pets(): void {
    renderPets(this.ctx, this.o.profile.activePet);
  }

  relics(): void {
    renderRelics(this.ctx);
  }

  mode(id: ModeId): void {
    this.o.profile.markModeSeen(id);
    if (id === 'adventure') {
      // Open on the chapter of the next stage to beat.
      const next = this.o.profile.nextStage();
      this.stageMap(next?.chapter);
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
