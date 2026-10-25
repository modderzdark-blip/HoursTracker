/**
 * The story told around the fighting: the prologue on first launch, a lore card when a chapter
 * begins, a line from every boss (before the fight, when it falls, and when it wins) and the
 * moment a chapter is completed. All text is original to Ashbound.
 */
import type { BossId } from './bosses';
import type { HeroId } from './heroes';

/** Painted backdrop of a narration card (CSS + inline SVG layers, no image assets). */
export type StoryScene = 'skyfire' | 'spire' | 'risen' | 'oath';

export interface StoryCard {
  readonly scene: StoryScene;
  readonly title: string;
  readonly text: string;
}

export const PROLOGUE: readonly StoryCard[] = [
  {
    scene: 'skyfire',
    title: 'The Ashfall',
    text: 'A hundred years ago the sky caught fire. It has been raining ash ever since.',
  },
  {
    scene: 'spire',
    title: 'The Bound King',
    text: 'They say a king sleeps in chains atop the Demon Spire. They say the ash is his breath — and that the chains are breaking.',
  },
  {
    scene: 'risen',
    title: 'The Ashbound',
    text: 'Those the ash marks do not die as others do. They rise, and they hunt. The shadow remembers every one of their names.',
  },
  {
    scene: 'oath',
    title: 'Your Oath',
    text: 'You are Ashbound. The March is falling. Take up your blade — and walk into the fire.',
  },
];

export interface ChapterStory {
  /** Roman numeral shown on the cards. */
  readonly numeral: string;
  readonly scene: StoryScene;
  /** One line of lore on the chapter intro card. */
  readonly intro: string;
  /** Shown when the chapter's last stage is cleared for the first time. */
  readonly outro: string;
}

export const CHAPTER_STORY: Readonly<Record<number, ChapterStory>> = {
  1: {
    numeral: 'I',
    scene: 'skyfire',
    intro:
      'The March was a kingdom once. Now its gates are soot, and its warden guards nothing but cinders.',
    outro:
      'The Cinder Gate lies open. Beyond it the wastes burn — and something in the smoke is singing.',
  },
  2: {
    numeral: 'II',
    scene: 'risen',
    intro:
      'Past the gate the earth itself smolders. Seers walk the ridges, singing the ash down from the sky.',
    outro:
      'For one breath the sky clears. On the horizon the Spire rises — and its chains are groaning.',
  },
  3: {
    numeral: 'III',
    scene: 'spire',
    intro:
      'The Spire was built as a prison. Every stone an oath, every chain a promise. The promises are breaking.',
    outro:
      'The King falls silent. Yet the ash keeps falling — rising now from somewhere far below.',
  },
  4: {
    numeral: 'IV',
    scene: 'oath',
    intro:
      'Beneath the Spire the world is hollow. Something vast has been breathing down there for a thousand years.',
    outro:
      'The first fire is out. Ash settles on a silent world — and for the first time in an age, the sky is blue.',
  },
};

export interface BossLines {
  /** Spoken on the boss intro card. */
  readonly taunt: string;
  /** Last words, under the "falls" banner. */
  readonly fall: string;
  /** On the defeat screen when the boss wins. */
  readonly triumph: string;
}

export const BOSS_LINES: Readonly<Record<BossId, BossLines>> = {
  gaoler: {
    taunt: 'Another runaway. My chains have room for one more.',
    fall: 'The chains… were never mine to hold…',
    triumph: 'Back to the pits with you.',
  },
  hollow_warden: {
    taunt: 'None pass the Cinder Gate. Not the living. Not you.',
    fall: 'The gate is open… he will see you coming…',
    triumph: 'The gate holds. It always holds.',
  },
  seer_exalted: {
    taunt: 'Hush. The choir already sings your ending.',
    fall: 'The song goes on… without me…',
    triumph: 'Your silence is the sweetest verse.',
  },
  mother_of_ash: {
    taunt: 'Little ember. I smothered the sun — I will smother you.',
    fall: 'My brood… will remember you…',
    triumph: 'Sleep now, beneath my wings.',
  },
  penitent: {
    taunt: 'I swore to keep him bound. I will keep you out.',
    fall: 'Forgive me… I could not hold…',
    triumph: 'Penance is endless. So is my watch.',
  },
  bound_king: {
    taunt: 'You climbed all this way to set me free? How kind.',
    fall: 'The ash… was only… my breath…',
    triumph: 'Kneel. All things kneel, in the end.',
  },
  ash_behemoth: {
    taunt: 'The cavern shudders. Gorgrath has smelled you.',
    fall: 'The behemoth crashes down, and the Deep falls quiet.',
    triumph: 'Gorgrath sinks back into its slumber, sated.',
  },
  brood_weaver: {
    taunt: 'Such a fine thread you are. I will weave you in.',
    fall: 'My web… unravels…',
    triumph: 'Another thread for the tapestry.',
  },
  cinder_wyrm: {
    taunt: 'I was the first fire. I will be the last.',
    fall: 'The first fire… gutters out…',
    triumph: 'Burn, little ember. Burn with me.',
  },
};

/** A hero's own words on the victory and defeat screens. */
export interface HeroLines {
  readonly victory: string;
  readonly defeat: string;
}

export const HERO_LINES: Readonly<Record<HeroId, HeroLines>> = {
  kael: { victory: 'Too slow. All of you.', defeat: 'Not like this… not yet.' },
  brann: {
    victory: 'My oath stands. They do not.',
    defeat: 'An oath outlives the one who swore it.',
  },
  lyra: {
    victory: 'The dusk sees everything. It saw them fall.',
    defeat: 'I missed… I never miss.',
  },
  garrick: {
    victory: 'Behind me, nothing falls.',
    defeat: 'Even iron bends. Then it is forged again.',
  },
  seraphine: {
    victory: 'Ash to ash. I only hurried it along.',
    defeat: 'The ember dims. It does not die.',
  },
  ryn: { victory: 'Fists still warm. Who is next?', defeat: 'Get up. Get up and swing again.' },
  valka: {
    victory: 'The storm has passed. I am the storm.',
    defeat: 'Thunder fades… and returns.',
  },
  morrow: {
    victory: 'Rest now. I will remember your names.',
    defeat: 'Even the grave lets me go.',
  },
};

/** Lore lines shown while the game loads (title screen, battle loading veil). */
export const LORE_TIPS: readonly string[] = [
  'The ash never stops falling. Old hunters say you learn to taste the weather in it.',
  'The Gaoler once kept prisoners for the Bound King. Now he keeps anyone he can catch.',
  'Embers that rise from fallen foes are souls. The Ashbound gather them to grow stronger.',
  'The Cinder Choir believes the ash is a hymn. Their seers sing it down from the sky.',
  'Every chain on the Demon Spire was forged with a promise. Every broken link is a lie.',
  'Ember Hearths burn even while you rest. Return to them for gold the ash has left behind.',
  'The Mother of Ash nests where the smoke is thickest. Her brood is never far.',
  'Some say the Hollow Deep is older than the sky. Something down there remembers the first fire.',
  'An Ashbound who falls rises again. The shadow remembers their name.',
  'Gear forged in the March is crude but honest. Upgrade it, and it will not fail you.',
];

/** Deterministic tip for a seed (a counter, a stage index…). */
export function loreTip(seed: number): string {
  const n = LORE_TIPS.length;
  const i = ((Math.floor(seed) % n) + n) % n;
  return LORE_TIPS[i] ?? LORE_TIPS[0] ?? '';
}
