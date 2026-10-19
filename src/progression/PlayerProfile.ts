import type { StatBlock } from '../data/combatTypes';
import { DIFFICULTIES, type DifficultyId } from '../data/difficulty';
import { HEROES, type HeroId } from '../data/heroes';
import { GEAR_CONFIG, GEAR_SLOTS, type GearSlot } from '../data/items';
import { MODES, type ModeId } from '../data/modes';
import { CACHE_CONFIG, STAR_GEMS } from '../data/progression';
import { SKILL_TREES } from '../data/skillTrees';
import { CHAPTERS, type AdventureStageDef } from '../data/stages';
import type { SaveData, StageRecord } from '../save/SaveStore';
import { rollItem, salvageValue, tryUpgrade, type GearItem, type UpgradeOutcome } from './gear';
import { rollItemLevel, rollRarity } from './loot';
import { computeHeroStats, powerRating } from './heroStats';
import type { HeroProgress, ProfileData } from './profile';
import { computeMods, rankUp, type HeroMods } from './skillTree';
import { Wallet } from './wallet';
import { addXp } from './xp';

export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['normal', 'hard', 'nightmare'];

export interface SalvageSummary {
  count: number;
  materials: number;
  gold: number;
}

export interface StageSubmit {
  /** First clear of this stage at this difficulty. */
  readonly firstClear: boolean;
  readonly previousStars: number;
  /** Gems for stars earned for the first time. */
  readonly starGems: number;
}

/**
 * The player's persistent state behind one API: wallet, heroes, gear, skill trees, stage records
 * and mode unlocks. Screens call these methods; every change ends with `commit()` (wallet sync +
 * debounced save).
 */
export class PlayerProfile {
  readonly wallet: Wallet;

  constructor(
    private readonly save: SaveData,
    private readonly persist: () => void,
    private readonly rng: () => number,
  ) {
    this.wallet = new Wallet(save.wallet);
  }

  get data(): ProfileData {
    return this.save.profile;
  }

  /** Writes the wallet back into the save and schedules a save. */
  commit(): void {
    this.save.wallet = this.wallet.snapshot();
    this.persist();
  }

  // ------------------------------------------------------------------ heroes

  hero(id: HeroId): HeroProgress {
    return this.data.heroes[id];
  }

  get selectedHero(): HeroId {
    return this.data.selectedHero;
  }

  selectHero(id: HeroId): boolean {
    if (!this.hero(id).unlocked) return false;
    this.data.selectedHero = id;
    this.commit();
    return true;
  }

  heroUnlockBlock(id: HeroId): 'unlocked' | 'stage' | 'souls' | null {
    const h = this.hero(id);
    const u = HEROES[id].unlock;
    if (h.unlocked || u === null) return 'unlocked';
    if (!this.stageClearedAnyDifficulty(u.afterStage)) return 'stage';
    if (!this.wallet.canAfford('souls', u.souls)) return 'souls';
    return null;
  }

  unlockHero(id: HeroId): boolean {
    const u = HEROES[id].unlock;
    if (u === null || this.heroUnlockBlock(id) !== null) return false;
    if (!this.wallet.spend('souls', u.souls)) return false;
    this.hero(id).unlocked = true;
    this.commit();
    return true;
  }

  /** Adds XP to a hero; returns levels gained. */
  grantXp(id: HeroId, xp: number): number {
    const gained = addXp(this.hero(id), xp);
    this.commit();
    return gained;
  }

  mods(id: HeroId): HeroMods {
    return computeMods(SKILL_TREES[id], this.hero(id).skills);
  }

  stats(id: HeroId): StatBlock {
    return computeHeroStats(HEROES[id], this.hero(id).level, this.equippedItems(id), this.mods(id));
  }

  /** Stats if `item` replaced what is in its slot (for comparisons). */
  statsWith(id: HeroId, item: GearItem): StatBlock {
    const items = this.equippedItems(id).filter((i) => i.slot !== item.slot);
    items.push(item);
    return computeHeroStats(HEROES[id], this.hero(id).level, items, this.mods(id));
  }

  power(id: HeroId): number {
    return powerRating(this.stats(id));
  }

  rankUpSkill(id: HeroId, nodeId: string): boolean {
    const node = SKILL_TREES[id].find((n) => n.id === nodeId);
    if (node === undefined) return false;
    const h = this.hero(id);
    if (!rankUp(node, h.skills, h.level, this.wallet)) return false;
    this.commit();
    return true;
  }

  // ------------------------------------------------------------------ gear

  item(uid: number): GearItem | undefined {
    return this.data.items.find((i) => i.uid === uid);
  }

  equippedItems(id: HeroId): GearItem[] {
    const out: GearItem[] = [];
    const eq = this.hero(id).equipped;
    for (const slot of GEAR_SLOTS) {
      const uid = eq[slot];
      const item = uid === undefined ? undefined : this.item(uid);
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  equippedIn(id: HeroId, slot: GearSlot): GearItem | undefined {
    const uid = this.hero(id).equipped[slot];
    return uid === undefined ? undefined : this.item(uid);
  }

  /** Hero currently wearing the item, if any. */
  wearer(uid: number): HeroId | null {
    for (const id of Object.keys(this.data.heroes) as HeroId[]) {
      const eq = this.data.heroes[id].equipped;
      for (const slot of GEAR_SLOTS) if (eq[slot] === uid) return id;
    }
    return null;
  }

  /** Equips on `id` (moving it off another hero if needed). */
  equip(id: HeroId, uid: number): boolean {
    const item = this.item(uid);
    if (item === undefined) return false;
    const other = this.wearer(uid);
    if (other !== null) delete this.hero(other).equipped[item.slot];
    this.hero(id).equipped[item.slot] = uid;
    item.isNew = false;
    this.commit();
    return true;
  }

  unequip(id: HeroId, slot: GearSlot): void {
    delete this.hero(id).equipped[slot];
    this.commit();
  }

  get inventoryFull(): boolean {
    return this.data.items.length >= GEAR_CONFIG.inventoryCap;
  }

  nextUid = (): number => this.data.nextUid++;

  /**
   * Adds dropped items. When the bag is full, overflow items are salvaged automatically (nothing
   * is ever lost silently: the summary reports them).
   */
  addLoot(items: readonly GearItem[]): { kept: GearItem[]; salvaged: SalvageSummary } {
    const kept: GearItem[] = [];
    const salvaged: SalvageSummary = { count: 0, materials: 0, gold: 0 };
    for (const item of items) {
      if (this.data.items.length < GEAR_CONFIG.inventoryCap) {
        this.data.items.push(item);
        kept.push(item);
      } else {
        const v = salvageValue(item);
        salvaged.count++;
        salvaged.materials += v.materials;
        salvaged.gold += v.gold;
      }
    }
    if (salvaged.materials > 0) this.wallet.add('materials', salvaged.materials);
    if (salvaged.gold > 0) this.wallet.add('gold', salvaged.gold);
    this.commit();
    return { kept, salvaged };
  }

  /** Salvages unlocked, unequipped items among `uids`. */
  salvage(uids: readonly number[]): SalvageSummary {
    const out: SalvageSummary = { count: 0, materials: 0, gold: 0 };
    const set = new Set(uids);
    const keep: GearItem[] = [];
    for (const item of this.data.items) {
      if (set.has(item.uid) && !item.locked && this.wearer(item.uid) === null) {
        const v = salvageValue(item);
        out.count++;
        out.materials += v.materials;
        out.gold += v.gold;
      } else {
        keep.push(item);
      }
    }
    this.data.items = keep;
    if (out.materials > 0) this.wallet.add('materials', out.materials);
    if (out.gold > 0) this.wallet.add('gold', out.gold);
    this.commit();
    return out;
  }

  upgrade(uid: number): UpgradeOutcome {
    const item = this.item(uid);
    if (item === undefined) return 'unaffordable';
    const r = tryUpgrade(item, this.wallet, this.rng);
    if (r === 'success' || r === 'failed') this.commit();
    return r;
  }

  /**
   * Ember Cache: spends tickets for one item (rare or better, pity applies) at the player's
   * progress level. Returns null if unaffordable or the bag is full.
   */
  openCache(): GearItem | null {
    if (this.inventoryFull || !this.wallet.spend('tickets', CACHE_CONFIG.ticketCost)) return null;
    let level = 1;
    for (const c of CHAPTERS)
      for (const st of c.stages)
        if (this.stageClearedAnyDifficulty(st.id)) level = Math.max(level, st.level);
    const difficulty: DifficultyId = this.difficultyUnlocked(1, 'nightmare')
      ? 'nightmare'
      : this.difficultyUnlocked(1, 'hard')
        ? 'hard'
        : 'normal';
    let rarity = rollRarity(this.rng, difficulty, this.data.pity);
    if (rarity === 'common') rarity = 'rare';
    const slots = GEAR_SLOTS;
    const slot = slots[Math.floor(this.rng() * slots.length)] ?? 'weapon';
    const item = rollItem(
      this.rng,
      this.nextUid(),
      slot,
      rarity,
      rollItemLevel(this.rng, level + CACHE_CONFIG.levelBonus, 'normal', rarity),
    );
    this.data.items.push(item);
    this.commit();
    return item;
  }

  toggleLock(uid: number): void {
    const item = this.item(uid);
    if (item === undefined) return;
    item.locked = !item.locked;
    this.commit();
  }

  clearNewFlags(): void {
    let changed = false;
    for (const i of this.data.items) {
      if (i.isNew) {
        i.isNew = false;
        changed = true;
      }
    }
    if (changed) this.commit();
  }

  // ------------------------------------------------------------------ stages

  static recordKey(stageId: string, difficulty: DifficultyId): string {
    return `${stageId}:${difficulty}`;
  }

  record(stageId: string, difficulty: DifficultyId): StageRecord | undefined {
    return this.save.records[PlayerProfile.recordKey(stageId, difficulty)];
  }

  stageClearedAnyDifficulty(stageId: string): boolean {
    return DIFFICULTY_ORDER.some((d) => (this.record(stageId, d)?.clears ?? 0) > 0);
  }

  chapterCleared(chapter: number, difficulty: DifficultyId): boolean {
    const ch = CHAPTERS.find((c) => c.number === chapter);
    if (ch === undefined) return false;
    return ch.stages.every((s) => (this.record(s.id, difficulty)?.clears ?? 0) > 0);
  }

  /** Normal is always open; Hard needs the chapter cleared on Normal; Nightmare on Hard. */
  difficultyUnlocked(chapter: number, difficulty: DifficultyId): boolean {
    const i = DIFFICULTY_ORDER.indexOf(difficulty);
    if (i <= 0) return true;
    const prev = DIFFICULTY_ORDER[i - 1];
    return prev !== undefined && this.chapterCleared(chapter, prev);
  }

  /** A stage is open when the previous one (or the previous chapter's last) is cleared. */
  stageUnlocked(stage: AdventureStageDef, difficulty: DifficultyId): boolean {
    if (!this.difficultyUnlocked(stage.chapter, difficulty)) return false;
    if (stage.index > 0) {
      const ch = CHAPTERS.find((c) => c.number === stage.chapter);
      const prev = ch?.stages[stage.index - 1];
      return prev !== undefined && (this.record(prev.id, difficulty)?.clears ?? 0) > 0;
    }
    if (stage.chapter === 1) return true;
    const prevCh = CHAPTERS.find((c) => c.number === stage.chapter - 1);
    const last = prevCh?.stages[prevCh.stages.length - 1];
    return last !== undefined && (this.record(last.id, difficulty)?.clears ?? 0) > 0;
  }

  /** Records a clear; grants gems for stars earned the first time. */
  submitStageResult(
    stageId: string,
    difficulty: DifficultyId,
    stars: number,
    timeSec: number,
  ): StageSubmit {
    const key = PlayerProfile.recordKey(stageId, difficulty);
    const prev = this.save.records[key];
    const prevStars = prev?.bestStars ?? 0;
    let starGems = 0;
    for (let s = prevStars + 1; s <= stars; s++) starGems += STAR_GEMS[s] ?? 0;
    starGems = Math.round(starGems * DIFFICULTIES[difficulty].rewards);
    this.save.records[key] = {
      bestStars: Math.max(stars, prevStars),
      bestTimeSec:
        prev === undefined || prev.bestTimeSec <= 0 ? timeSec : Math.min(prev.bestTimeSec, timeSec),
      clears: (prev?.clears ?? 0) + 1,
    };
    if (starGems > 0) this.wallet.add('gems', starGems);
    this.commit();
    return {
      firstClear: prev === undefined || prev.clears === 0,
      previousStars: prevStars,
      starGems,
    };
  }

  totalStars(chapter: number, difficulty: DifficultyId): number {
    const ch = CHAPTERS.find((c) => c.number === chapter);
    let n = 0;
    for (const s of ch?.stages ?? []) n += this.record(s.id, difficulty)?.bestStars ?? 0;
    return n;
  }

  modeUnlocked(mode: ModeId): boolean {
    const req = MODES[mode].requiresStage;
    return req === null || this.stageClearedAnyDifficulty(req);
  }
}
