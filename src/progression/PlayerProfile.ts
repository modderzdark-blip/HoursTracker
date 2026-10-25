import type { StatBlock } from '../data/combatTypes';
import { DIFFICULTIES, type DifficultyId } from '../data/difficulty';
import { HEROES, type HeroId } from '../data/heroes';
import { GEAR_CONFIG, GEAR_SLOTS, type GearSlot } from '../data/items';
import { CHALLENGE_CONFIG, MODES, type ModeId } from '../data/modes';
import {
  ACHIEVEMENTS,
  BLESSING_CONFIG,
  type AchievementStat,
  type GoalEvent,
  type QuestDef,
} from '../data/goals';
import { CACHE_CONFIG, STAR_GEMS, XP_CONFIG } from '../data/progression';
import { SKILL_TREES } from '../data/skillTrees';
import { CHAPTERS, type AdventureStageDef } from '../data/stages';
import { dailyHunts, highestClearedLevel, huntRank, type HuntDef } from '../modes/meta';
import type { SaveData, StageRecord } from '../save/SaveStore';
import type { RewardBundle } from '../data/goals';
import { nextAdventureStage, type GoalSnapshot } from './feel';
import {
  itemPower,
  rollItem,
  salvageValue,
  tryUpgrade,
  upgradeCost,
  type GearItem,
  type UpgradeOutcome,
} from './gear';
import {
  achievementById,
  blessingFor,
  claimableTiers,
  claimDailyBonus,
  claimLogin,
  claimQuest,
  dailyBonusReady,
  hearthYield,
  localDay,
  loginReady,
  questDone,
  refreshDaily,
  trackQuests,
  type Blessing,
  type HearthYield,
} from './goals';
import { rollItemLevel, rollRarity } from './loot';
import { computeHeroStats, powerRating } from './heroStats';
import type { HeroProgress, ProfileData } from './profile';
import { computeMods, rankBlock, rankUp, type HeroMods } from './skillTree';
import { Wallet } from './wallet';
import { addXp } from './xp';

export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['normal', 'hard', 'nightmare'];

export interface SalvageSummary {
  count: number;
  materials: number;
  gold: number;
}

/** Things the player can act on right now (red "new" dots on the hub). */
export interface Attention {
  /** Heroes that can be summoned now. */
  readonly heroes: number;
  /** New items in the bag. */
  readonly newItems: number;
  /** An equipped item can be upgraded, or a better item waits in the bag. */
  readonly gearUpgrade: boolean;
  /** Skill-tree ranks the selected hero can buy now. */
  readonly skills: number;
  /** Quests, gifts and achievements waiting to be claimed. */
  readonly journal: number;
  /** Modes unlocked but never opened. */
  readonly newModes: readonly ModeId[];
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

  /**
   * Adds XP to a hero; returns levels gained. Other unlocked heroes earn a share
   * (`XP_CONFIG.benchShare`) so switching heroes never means starting from scratch.
   */
  grantXp(id: HeroId, xp: number): number {
    const gained = addXp(this.hero(id), xp);
    const bench = Math.floor(xp * XP_CONFIG.benchShare);
    if (bench > 0) {
      for (const other of Object.keys(this.data.heroes) as HeroId[]) {
        if (other !== id && this.hero(other).unlocked) addXp(this.hero(other), bench);
      }
    }
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
    this.track('salvage', out.count);
    this.commit();
    return out;
  }

  upgrade(uid: number): UpgradeOutcome {
    const item = this.item(uid);
    if (item === undefined) return 'unaffordable';
    const r = tryUpgrade(item, this.wallet, this.rng);
    if (r === 'success') {
      this.data.lifetime.upgrades++;
      this.data.lifetime.bestPlus = Math.max(this.data.lifetime.bestPlus, item.plus);
    }
    if (r === 'success' || r === 'failed') {
      this.track('upgrade', 1);
      this.commit();
    }
    return r;
  }

  /**
   * Ember Cache: spends tickets for one item (rare or better, pity applies) at the player's
   * progress level. Returns null if unaffordable or the bag is full.
   */
  openCache(): GearItem | null {
    if (this.inventoryFull || !this.wallet.spend('tickets', CACHE_CONFIG.ticketCost)) return null;
    const level = this.progressLevel();
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

  /** Today's hunt board; the list of hunts won resets at local midnight. */
  huntBoard(nowMs = Date.now()): HuntDef[] {
    const day = localDay(nowMs);
    const h = this.data.hunts;
    if (h.day !== day) {
      h.day = day;
      h.won = [];
    }
    const cleared = (id: string): boolean => this.stageClearedAnyDifficulty(id);
    const unlocked = CHALLENGE_CONFIG.bosses.filter((c) => cleared(c.stage));
    return dailyHunts(day, unlocked, huntRank(h.completed), highestClearedLevel(cleared));
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

  /** Highest Adventure level cleared on any difficulty (1 before the first clear). */
  progressLevel(): number {
    let level = 1;
    for (const c of CHAPTERS)
      for (const st of c.stages)
        if (this.stageClearedAnyDifficulty(st.id)) level = Math.max(level, st.level);
    return level;
  }

  allStars(): number {
    let n = 0;
    for (const c of CHAPTERS) for (const d of DIFFICULTY_ORDER) n += this.totalStars(c.number, d);
    return n;
  }

  // ------------------------------------------------------------------ daily quests + login

  private readonly questOpen = (q: QuestDef): boolean =>
    q.needsMode === undefined || this.modeUnlocked(q.needsMode);

  /** Rolls today's quests if the local day changed. */
  refreshDaily(nowMs = Date.now()): void {
    if (refreshDaily(this.data.daily, localDay(nowMs), this.questOpen)) this.commit();
  }

  /** Counts an event toward today's quests (the caller commits). */
  track(event: GoalEvent, amount = 1): void {
    refreshDaily(this.data.daily, localDay(Date.now()), this.questOpen);
    trackQuests(this.data.daily, event, amount);
  }

  /**
   * Everything one finished battle counts toward: quests, lifetime dodges and the Ember
   * Blessing (a defeat on an Adventure stage adds a stack, the clear removes them).
   */
  trackBattle(
    kind: 'adventure' | 'dungeon' | 'tower' | 'challenge' | 'hunt' | 'arena',
    outcome: {
      readonly victory: boolean;
      readonly abandoned: boolean;
      readonly kills: number;
      readonly perfectDodges: number;
      readonly bossKilled: boolean;
      readonly stars: number;
    },
    stage?: { readonly stageId: string; readonly difficulty: DifficultyId },
  ): void {
    this.track('kill', outcome.kills);
    this.track('perfectDodge', outcome.perfectDodges);
    this.data.lifetime.perfectDodges += Math.max(0, Math.floor(outcome.perfectDodges));
    if (kind === 'arena') this.track('arenaFight', 1);
    if (outcome.victory) {
      this.track('victory', 1);
      if (outcome.bossKilled) this.track('bossKill', 1);
      if (kind === 'tower') this.track('towerFloor', 1);
      if (kind === 'challenge') this.track('challengeWin', 1);
      if (kind === 'adventure' && outcome.stars >= 3) this.track('threeStars', 1);
    }
    if (stage !== undefined) {
      const key = PlayerProfile.recordKey(stage.stageId, stage.difficulty);
      if (outcome.victory) delete this.data.blessings[key];
      else if (!outcome.abandoned)
        this.data.blessings[key] = Math.min(
          BLESSING_CONFIG.maxStacks,
          (this.data.blessings[key] ?? 0) + 1,
        );
    }
    this.commit();
  }

  claimQuest(id: string): boolean {
    if (!claimQuest(this.data.daily, id, this.wallet)) return false;
    this.commit();
    return true;
  }

  get dailyBonusReady(): boolean {
    return dailyBonusReady(this.data.daily);
  }

  claimDailyBonus(): boolean {
    if (!claimDailyBonus(this.data.daily, this.wallet)) return false;
    this.commit();
    return true;
  }

  loginReady(nowMs = Date.now()): boolean {
    return loginReady(this.data.daily, localDay(nowMs));
  }

  claimLogin(nowMs = Date.now()): RewardBundle | null {
    const r = claimLogin(this.data.daily, localDay(nowMs), this.wallet);
    if (r !== null) this.commit();
    return r;
  }

  // ------------------------------------------------------------------ hearth

  hearth(nowMs = Date.now()): HearthYield {
    if (nowMs < this.data.hearth.sinceMs) this.data.hearth.sinceMs = nowMs;
    return hearthYield(this.data.hearth.sinceMs, nowMs, this.progressLevel());
  }

  /** Collects the hearth (gold, materials, XP for the selected hero). Null if too early. */
  collectHearth(nowMs = Date.now()): (HearthYield & { levelsGained: number }) | null {
    const y = this.hearth(nowMs);
    if (y.gold <= 0 && y.xp <= 0) return null;
    this.data.hearth.sinceMs = nowMs;
    this.wallet.add('gold', y.gold);
    if (y.materials > 0) this.wallet.add('materials', y.materials);
    const levelsGained = this.grantXp(this.selectedHero, y.xp);
    this.commit();
    return { ...y, levelsGained };
  }

  // ------------------------------------------------------------------ blessing

  blessing(stageId: string, difficulty: DifficultyId): Blessing {
    return blessingFor(this.data.blessings[PlayerProfile.recordKey(stageId, difficulty)] ?? 0);
  }

  // ------------------------------------------------------------------ achievements

  achievementValue(stat: AchievementStat): number {
    const d = this.data;
    switch (stat) {
      case 'kills':
        return d.lifetime.kills;
      case 'bossKills':
        return d.lifetime.bossKills;
      case 'victories':
        return d.lifetime.victories;
      case 'stars':
        return this.allStars();
      case 'heroLevel':
        return Math.max(...Object.values(d.heroes).map((h) => h.level));
      case 'towerFloor':
        return d.tower.bestFloor;
      case 'arenaRating':
        return d.arena.bestRating;
      case 'perfectDodges':
        return d.lifetime.perfectDodges;
      case 'bestPlus':
        return d.lifetime.bestPlus;
      case 'heroes':
        return Object.values(d.heroes).filter((h) => h.unlocked).length;
    }
  }

  achievementClaimable(id: string): number {
    const a = achievementById(id);
    if (a === undefined) return 0;
    return claimableTiers(a, this.data.achievements[id] ?? 0, this.achievementValue(a.stat));
  }

  /** Claims the next reached tier; returns the gems paid, or 0. */
  claimAchievement(id: string): number {
    const a = achievementById(id);
    if (a === undefined || this.achievementClaimable(id) <= 0) return 0;
    const tier = this.data.achievements[id] ?? 0;
    const gems = a.gems[tier] ?? 0;
    this.data.achievements[id] = tier + 1;
    if (gems > 0) this.wallet.add('gems', gems);
    this.commit();
    return gems;
  }

  // ------------------------------------------------------------------ attention & goals

  /** Daily quests finished and achievement tiers reached (for "goal reached" toasts). */
  goalSnapshot(nowMs = Date.now()): GoalSnapshot {
    this.refreshDaily(nowMs);
    const achievements: Record<string, number> = {};
    for (const a of ACHIEVEMENTS) {
      const reached = (this.data.achievements[a.id] ?? 0) + this.achievementClaimable(a.id);
      if (reached > 0) achievements[a.id] = reached;
    }
    return {
      quests: this.data.daily.quests.filter((q) => questDone(q)).map((q) => q.id),
      achievements,
    };
  }

  /** What deserves a red dot on the hub. */
  attention(nowMs = Date.now()): Attention {
    const id = this.selectedHero;
    let heroes = 0;
    for (const h of Object.keys(HEROES) as HeroId[]) if (this.heroUnlockBlock(h) === null) heroes++;
    let gearUpgrade = false;
    for (const slot of GEAR_SLOTS) {
      const worn = this.equippedIn(id, slot);
      if (worn !== undefined) {
        const cost = upgradeCost(worn);
        if (
          cost !== null &&
          this.wallet.canAfford('gold', cost.gold) &&
          this.wallet.canAfford('materials', cost.materials)
        )
          gearUpgrade = true;
      }
      const wornPower = worn === undefined ? 0 : itemPower(worn);
      if (
        this.data.items.some(
          (i) => i.slot === slot && this.wearer(i.uid) === null && itemPower(i) > wornPower,
        )
      )
        gearUpgrade = true;
      if (gearUpgrade) break;
    }
    const h = this.hero(id);
    const skills = SKILL_TREES[id].filter(
      (n) => rankBlock(n, h.skills, h.level, this.wallet) === null,
    ).length;
    const seen = this.data.story.modesSeen;
    const newModes = (Object.keys(MODES) as ModeId[]).filter(
      (m) => this.modeUnlocked(m) && !seen.includes(m),
    );
    return {
      heroes,
      newItems: this.data.items.filter((i) => i.isNew).length,
      gearUpgrade,
      skills,
      journal: this.pendingClaims(nowMs),
      newModes,
    };
  }

  /** A mode screen was opened: it is no longer new. */
  markModeSeen(mode: ModeId): void {
    if (this.data.story.modesSeen.includes(mode)) return;
    this.data.story.modesSeen.push(mode);
    this.commit();
  }

  /** The next Adventure stage to clear (hub "Next:" line), or null when all are cleared. */
  nextStage(): AdventureStageDef | null {
    return nextAdventureStage((sid) => this.stageClearedAnyDifficulty(sid));
  }

  /** Count of things waiting to be claimed (hub badge). */
  pendingClaims(nowMs = Date.now()): number {
    let n = 0;
    this.refreshDaily(nowMs);
    for (const q of this.data.daily.quests) if (!q.claimed && questDone(q)) n++;
    if (this.dailyBonusReady) n++;
    if (this.loginReady(nowMs)) n++;
    for (const a of ACHIEVEMENTS) if (this.achievementClaimable(a.id) > 0) n++;
    return n;
  }
}
