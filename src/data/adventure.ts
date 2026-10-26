/**
 * The whole Adventure as one endless list of chapters: the hand-made chapters 1–4
 * (src/data/stages.ts) followed by generated ones (src/data/endless.ts), built on first use and
 * cached. Stage ids are `c<chapter>s<stage>` everywhere, so saves keep working as chapters are
 * added.
 */
import { ENDLESS_CONFIG, generateChapter } from './endless';
import { CHAPTERS, type AdventureStageDef, type ChapterDef } from './stages';

export const MAX_CHAPTER = ENDLESS_CONFIG.maxChapter;

const generated = new Map<number, ChapterDef>();

/** Chapter `n` (1..MAX_CHAPTER), or undefined outside that range. */
export function chapterDef(n: number): ChapterDef | undefined {
  if (!Number.isInteger(n) || n < 1 || n > MAX_CHAPTER) return undefined;
  const hand = CHAPTERS.find((c) => c.number === n);
  if (hand !== undefined) return hand;
  let c = generated.get(n);
  if (c === undefined) {
    c = generateChapter(n);
    generated.set(n, c);
  }
  return c;
}

/** True for chapters made by the generator (no hand-written story). */
export function isGeneratedChapter(n: number): boolean {
  return n >= ENDLESS_CONFIG.firstChapter && n <= MAX_CHAPTER;
}

const STAGE_ID = /^c(\d{1,4})s(\d{1,2})$/;

/** Parses `c7s3` → { chapter: 7, index: 2 } (null for anything else). */
export function parseStageId(id: string): { chapter: number; index: number } | null {
  const m = STAGE_ID.exec(id);
  if (m === null) return null;
  return { chapter: Number(m[1]), index: Number(m[2]) - 1 };
}

export function findAdventureStage(id: string): AdventureStageDef | undefined {
  const p = parseStageId(id);
  if (p === null) return undefined;
  const s = chapterDef(p.chapter)?.stages[p.index];
  return s?.id === id ? s : undefined;
}

/** The last stage of a chapter (its boss). */
function finalStage(c: ChapterDef): AdventureStageDef | undefined {
  return c.stages[c.stages.length - 1];
}

/**
 * The deepest chapter the player can enter: chapter 1, plus one for each chapter in a row whose
 * boss has fallen (on any difficulty, as `cleared` reports).
 */
export function adventureFrontier(cleared: (stageId: string) => boolean): number {
  let n = 1;
  while (n < MAX_CHAPTER) {
    const c = chapterDef(n);
    const last = c === undefined ? undefined : finalStage(c);
    if (last === undefined || !cleared(last.id)) break;
    n++;
  }
  return n;
}

/** Chapters 1..`last` (the ones a loop over "every chapter so far" should visit). */
export function chaptersUpTo(last: number): ChapterDef[] {
  const out: ChapterDef[] = [];
  for (let n = 1; n <= Math.min(last, MAX_CHAPTER); n++) {
    const c = chapterDef(n);
    if (c !== undefined) out.push(c);
  }
  return out;
}
