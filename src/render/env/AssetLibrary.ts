import {
  BufferAttribute,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  type Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { MaterialMaps } from './TextureSynth';

/**
 * One drawable part of a scanned model. The geometry keeps the node's rotation and scale with
 * its pivot at the node origin; `offset` is where that origin sits in the model. Placing the
 * whole model = placement × translate(offset); placing a single node (a wall piece from a kit,
 * one rock of a set) = placement alone.
 */
export interface ModelPart {
  readonly node: string;
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly offset: Vector3;
}

export interface AssetRequest {
  readonly surfaces: readonly string[];
  readonly models: readonly string[];
}

/**
 * Loads the CC0 scanned assets in public/assets (tools/assets/process.mjs makes them): tileable
 * PBR surfaces as MaterialMaps for the arena materials and meshopt-compressed glTF props split
 * into parts. Loaded once and kept while they are in use; `retain` frees what the next arena
 * does not need (phones have little GPU memory to spare).
 */
export class AssetLibrary {
  private readonly surfaces = new Map<string, MaterialMaps>();
  private readonly models = new Map<string, ModelPart[]>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly textures = new TextureLoader();
  private readonly gltf = new GLTFLoader();
  anisotropy = 1;

  constructor(private readonly base = 'assets/') {
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Loads everything requested (already loaded items are reused). */
  async preload(req: AssetRequest): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of req.surfaces) jobs.push(this.once(`s:${id}`, () => this.loadSurface(id)));
    for (const id of req.models) jobs.push(this.once(`m:${id}`, () => this.loadModel(id)));
    await Promise.all(jobs);
  }

  /** True when every requested item is loaded. */
  has(req: AssetRequest): boolean {
    return (
      req.surfaces.every((id) => this.surfaces.has(id)) &&
      req.models.every((id) => this.models.has(id))
    );
  }

  surface(id: string): MaterialMaps | undefined {
    return this.surfaces.get(id);
  }

  model(id: string): readonly ModelPart[] | undefined {
    return this.models.get(id);
  }

  /** Frees everything not in `keep`. */
  retain(keep: AssetRequest): void {
    for (const [id, maps] of this.surfaces) {
      if (keep.surfaces.includes(id)) continue;
      maps.dispose();
      this.surfaces.delete(id);
      this.loading.delete(`s:${id}`);
    }
    for (const [id, parts] of this.models) {
      if (keep.models.includes(id)) continue;
      disposeParts(parts);
      this.models.delete(id);
      this.loading.delete(`m:${id}`);
    }
  }

  dispose(): void {
    this.retain({ surfaces: [], models: [] });
  }

  private once(key: string, load: () => Promise<void>): Promise<void> {
    let p = this.loading.get(key);
    if (p === undefined) {
      p = load().catch((e: unknown) => {
        this.loading.delete(key);
        throw e;
      });
      this.loading.set(key, p);
    }
    return p;
  }

  private async loadSurface(id: string): Promise<void> {
    const dir = `${this.base}surfaces/${id}/`;
    const [albedo, normal, orm] = await Promise.all([
      this.texture(`${dir}albedo.webp`, true),
      this.texture(`${dir}normal.webp`, false),
      this.texture(`${dir}orm.webp`, false),
    ]);
    this.surfaces.set(id, {
      albedo,
      normal,
      orm,
      dispose(): void {
        albedo.dispose();
        normal.dispose();
        orm.dispose();
      },
    });
  }

  private async texture(url: string, srgb: boolean): Promise<Texture> {
    const t = await this.textures.loadAsync(url);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    t.anisotropy = this.anisotropy;
    return t;
  }

  private async loadModel(id: string): Promise<void> {
    const g = await this.gltf.loadAsync(`${this.base}models/${id}.glb`);
    g.scene.updateMatrixWorld(true);
    const parts: ModelPart[] = [];
    const t = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    const m = new Matrix4();
    g.scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.matrixWorld.decompose(t, q, s);
      const geometry = unpacked((o.geometry as BufferGeometry).clone());
      geometry.applyMatrix4(m.compose(new Vector3(), q, s));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mats = o.material as Material | Material[];
      const material = Array.isArray(mats) ? mats[0] : mats;
      if (material === undefined) return;
      // Parts are named after their glTF node (kit pieces, rocks of a set): the nearest ancestor
      // named after the model, since mesh objects may carry their mesh's name instead.
      let node = o.name;
      for (let a: Object3D | null = o; a !== null && a !== g.scene; a = a.parent)
        if (a.name.startsWith(id)) {
          node = a.name;
          break;
        }
      parts.push({ node, geometry, material, offset: t.clone() });
    });
    g.scene.traverse((o) => {
      if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
    });
    this.models.set(id, parts);
  }
}

/**
 * Meshopt-compressed models keep positions and normals as normalized integers, which cannot hold
 * baked scales (values clamp to ±1): convert them to floats first.
 */
function unpacked(g: BufferGeometry): BufferGeometry {
  for (const name of ['position', 'normal', 'tangent']) {
    const a = g.getAttribute(name) as BufferAttribute | undefined;
    if (a === undefined || (a.array instanceof Float32Array && !a.normalized)) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new BufferAttribute(out, a.itemSize));
  }
  return g;
}

function disposeParts(parts: readonly ModelPart[]): void {
  const mats = new Set<Material>();
  for (const p of parts) {
    p.geometry.dispose();
    mats.add(p.material);
  }
  for (const m of mats) {
    for (const v of Object.values(m)) if (isTexture(v)) v.dispose();
    m.dispose();
  }
}

function isTexture(v: unknown): v is Texture {
  return typeof v === 'object' && v !== null && (v as { isTexture?: boolean }).isTexture === true;
}
