import { BufferAttribute, Color, Vector3, type BufferGeometry, type Matrix4 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropMaterial, PropParts } from './props';

/** Every material a batch can hold: the prop materials plus banner cloth. */
export type BatchMaterial = PropMaterial | 'cloth';

/** Hanging motion for iron parts: pivot height (world y), sway per metre below it, phase. */
export type Sway = readonly [number, number, number];

const NO_SWAY: Sway = [0, 0, 0];

/**
 * Collects static set dressing by material — each add() bakes the part's transform and tint into
 * a copy — and merges every material into one geometry, so an arena's props cost one draw call
 * per material however many there are. Iron parts always carry `aSway` (zero for static ones);
 * cloth parts carry `aCloth`, whose phase is offset per banner so they wave out of step.
 */
export class PropBatch {
  private readonly lists = new Map<BatchMaterial, BufferGeometry[]>();
  private readonly tint = new Color();
  private readonly v = new Vector3();
  /** Triangles added so far, per material (budget checks). */
  readonly triangles = new Map<BatchMaterial, number>();

  add(
    kind: BatchMaterial,
    geo: BufferGeometry,
    matrix: Matrix4,
    tint: Color | number = 0xffffff,
    sway: Sway = NO_SWAY,
    clothPhase = 0,
  ): void {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    if (typeof tint === 'number') this.tint.setHex(tint);
    else this.tint.copy(tint);
    const col = g.getAttribute('color');
    if (col !== undefined) {
      for (let i = 0; i < col.count; i++) {
        col.setXYZ(
          i,
          col.getX(i) * this.tint.r,
          col.getY(i) * this.tint.g,
          col.getZ(i) * this.tint.b,
        );
      }
    }
    const n = g.getAttribute('position').count;
    if (kind === 'iron') {
      const s = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        s[i * 3] = sway[0];
        s[i * 3 + 1] = sway[1];
        s[i * 3 + 2] = sway[2];
      }
      g.setAttribute('aSway', new BufferAttribute(s, 3));
    }
    if (kind === 'cloth') {
      const c = g.getAttribute('aCloth');
      for (let i = 0; i < c.count; i++) c.setY(i, c.getY(i) + clothPhase);
    }
    let list = this.lists.get(kind);
    if (list === undefined) {
      list = [];
      this.lists.set(kind, list);
    }
    list.push(g);
    const tris = (g.index?.count ?? n) / 3;
    this.triangles.set(kind, (this.triangles.get(kind) ?? 0) + tris);
  }

  /**
   * Adds every part of a multi-material prop; flame anchors are transformed into `flames`.
   * `tints` colours each material (unlisted ones stay white).
   */
  addParts(
    prop: PropParts,
    matrix: Matrix4,
    tints: Partial<Record<PropMaterial, Color | number>>,
    flames?: { x: number; y: number; z: number; size: number }[],
    sway: Sway = NO_SWAY,
  ): void {
    for (const key of Object.keys(prop.parts) as PropMaterial[]) {
      const g = prop.parts[key];
      if (g !== undefined) this.add(key, g, matrix, tints[key] ?? 0xffffff, sway);
    }
    if (flames !== undefined && prop.flames !== undefined) {
      const scale = matrix.getMaxScaleOnAxis();
      for (const [x, y, z, size] of prop.flames) {
        this.v.set(x, y, z).applyMatrix4(matrix);
        flames.push({ x: this.v.x, y: this.v.y, z: this.v.z, size: size * scale });
      }
    }
  }

  has(kind: BatchMaterial): boolean {
    return (this.lists.get(kind)?.length ?? 0) > 0;
  }

  /** Merges one material's parts (and frees the copies); null if it has none. */
  merge(kind: BatchMaterial): BufferGeometry | null {
    const list = this.lists.get(kind);
    if (list === undefined || list.length === 0) return null;
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    this.lists.delete(kind);
    if (merged === null) throw new Error(`prop batch merge failed: ${kind}`);
    merged.computeBoundingSphere();
    return merged;
  }

  /** Frees anything not merged. */
  dispose(): void {
    for (const list of this.lists.values()) for (const g of list) g.dispose();
    this.lists.clear();
  }
}
