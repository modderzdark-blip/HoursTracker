import type { SkillNodeDef } from '../data/skillTrees';
import type { StatusId } from '../data/statusEffects';
import type { Wallet } from './wallet';

/** Everything the skill tree changes, folded into multipliers the Player applies. */
export interface HeroMods {
  readonly skillDamage: [number, number, number];
  readonly skillCooldown: [number, number, number];
  readonly skillStatus: [SkillStatusMod | null, SkillStatusMod | null, SkillStatusMod | null];
  readonly skillSuperArmor: [boolean, boolean, boolean];
  comboDamage: number;
  ultDamage: number;
  ultGain: number;
  dodgeCooldown: number;
  /** Added to the hero's perfect-dodge counter multiplier. */
  counterBonus: number;
  critChance: number;
  lifesteal: number;
}

export interface SkillStatusMod {
  readonly status: StatusId;
  readonly chance: number;
}

export function emptyMods(): HeroMods {
  return {
    skillDamage: [1, 1, 1],
    skillCooldown: [1, 1, 1],
    skillStatus: [null, null, null],
    skillSuperArmor: [false, false, false],
    comboDamage: 1,
    ultDamage: 1,
    ultGain: 1,
    dodgeCooldown: 1,
    counterBonus: 0,
    critChance: 0,
    lifesteal: 0,
  };
}

/** Folds learned ranks into HeroMods. Unknown node ids and out-of-range ranks are ignored. */
export function computeMods(
  nodes: readonly SkillNodeDef[],
  ranks: Readonly<Record<string, number>>,
): HeroMods {
  const m = emptyMods();
  for (const n of nodes) {
    const rank = Math.min(n.maxRank, Math.max(0, Math.floor(ranks[n.id] ?? 0)));
    if (rank <= 0) continue;
    const e = n.effect;
    switch (e.kind) {
      case 'skillDamage':
        m.skillDamage[e.skill] += e.perRank * rank;
        break;
      case 'skillCooldown':
        m.skillCooldown[e.skill] = Math.max(0.3, m.skillCooldown[e.skill] - e.perRank * rank);
        break;
      case 'comboDamage':
        m.comboDamage += e.perRank * rank;
        break;
      case 'ultDamage':
        m.ultDamage += e.perRank * rank;
        break;
      case 'ultGain':
        m.ultGain += e.perRank * rank;
        break;
      case 'dodgeCooldown':
        m.dodgeCooldown = Math.max(0.3, m.dodgeCooldown - e.perRank * rank);
        break;
      case 'counterDamage':
        m.counterBonus += e.perRank * rank;
        break;
      case 'critChance':
        m.critChance += e.perRank * rank;
        break;
      case 'lifesteal':
        m.lifesteal += e.perRank * rank;
        break;
      case 'skillStatus':
        m.skillStatus[e.skill] = { status: e.status, chance: e.chance };
        break;
      case 'skillSuperArmor':
        m.skillSuperArmor[e.skill] = true;
        break;
    }
  }
  return m;
}

export interface RankCost {
  readonly souls: number;
  readonly gold: number;
}

/** Cost of the next rank (scales with the rank being bought). */
export function rankCost(node: SkillNodeDef, currentRank: number): RankCost {
  const next = currentRank + 1;
  return { souls: node.costSouls * next, gold: node.costGold * next };
}

export type RankBlock = 'maxed' | 'level' | 'requires' | 'souls' | 'gold' | null;

/** Why the node can't be ranked up right now (null = it can). */
export function rankBlock(
  node: SkillNodeDef,
  ranks: Readonly<Record<string, number>>,
  heroLevel: number,
  wallet: Wallet,
): RankBlock {
  const rank = ranks[node.id] ?? 0;
  if (rank >= node.maxRank) return 'maxed';
  if (heroLevel < node.minLevel) return 'level';
  if (node.requires !== null && (ranks[node.requires] ?? 0) < 1) return 'requires';
  const cost = rankCost(node, rank);
  if (!wallet.canAfford('souls', cost.souls)) return 'souls';
  if (!wallet.canAfford('gold', cost.gold)) return 'gold';
  return null;
}

/** Spends the cost and adds a rank. Returns false (and changes nothing) when blocked. */
export function rankUp(
  node: SkillNodeDef,
  ranks: Record<string, number>,
  heroLevel: number,
  wallet: Wallet,
): boolean {
  if (rankBlock(node, ranks, heroLevel, wallet) !== null) return false;
  const cost = rankCost(node, ranks[node.id] ?? 0);
  wallet.spend('souls', cost.souls);
  wallet.spend('gold', cost.gold);
  ranks[node.id] = (ranks[node.id] ?? 0) + 1;
  return true;
}

/** Souls + gold refunded by a full reset (everything spent). */
export function treeInvestment(
  nodes: readonly SkillNodeDef[],
  ranks: Readonly<Record<string, number>>,
): RankCost {
  let souls = 0;
  let gold = 0;
  for (const n of nodes) {
    const rank = Math.min(n.maxRank, ranks[n.id] ?? 0);
    for (let r = 0; r < rank; r++) {
      const c = rankCost(n, r);
      souls += c.souls;
      gold += c.gold;
    }
  }
  return { souls, gold };
}
