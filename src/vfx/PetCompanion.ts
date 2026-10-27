import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Scene,
} from 'three';
import type { PetLook } from '../data/pets';

const TAIL = 7;

/**
 * A pet in battle: a small glowing spirit creature built from primitives (body, head, eyes,
 * wings or a trailing tail, a soft halo). It hovers at the hero's shoulder, bobs and flaps,
 * turns toward what it attacks and lunges on a strike. About six draw calls.
 */
export class PetCompanion {
  readonly root = new Group();
  private readonly pos = new Vector3();
  private readonly vel = new Vector3();
  private readonly goal = new Vector3();
  private readonly look = new Vector3(0, 0, 1);
  private readonly lunge = new Vector3();
  private lungeT = 0;
  private time = Math.random() * 10;
  private readonly wings: Mesh[] = [];
  private readonly tail: InstancedMesh | null;
  private readonly trail: Vector3[] = [];
  private readonly body: Group;
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly halo: Sprite;
  private placed = false;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  // Scratch vectors: nothing is allocated per frame.
  private readonly dir = new Vector3();
  private readonly prev = new Vector3();
  private readonly to = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly def: PetLook,
  ) {
    const size = def.size;
    const glow = new Color(def.color);
    const bodyMat = this.mat(
      new MeshStandardMaterial({
        color: glow.clone().multiplyScalar(0.55),
        emissive: glow,
        emissiveIntensity: 1.1,
        roughness: 0.35,
        metalness: 0.1,
      }),
    );
    const accentMat = this.mat(
      new MeshStandardMaterial({
        color: new Color(def.accent).multiplyScalar(0.6),
        emissive: new Color(def.accent),
        emissiveIntensity: 0.9,
        roughness: 0.5,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: 2,
      }),
    );
    const eyeMat = this.mat(
      new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }),
    );
    this.body = new Group();
    this.root.add(this.body);

    const sphere = this.geo(new SphereGeometry(1, 16, 12));
    const serpent = def.shape === 'serpent';
    // Body and head (the serpent is all tail).
    if (!serpent) {
      const body = new Mesh(sphere, bodyMat);
      const long = def.shape === 'hound' || def.shape === 'fox' || def.shape === 'drake';
      body.scale.set(size * 0.8, size * 0.75, size * (long ? 1.25 : 0.95));
      this.body.add(body);
    }
    const head = new Mesh(sphere, bodyMat);
    head.scale.setScalar(size * (serpent ? 0.62 : 0.55));
    head.position.set(0, size * 0.45, size * (serpent ? 0.2 : 0.95));
    this.body.add(head);
    // Ears or horns.
    if (def.shape !== 'wisp' && def.shape !== 'moth') {
      const ears = this.geo(earGeometry(size));
      const e = new Mesh(ears, accentMat);
      e.position.copy(head.position);
      this.body.add(e);
    }
    // Eyes: two bright points merged into one mesh.
    const eyes = new Mesh(this.geo(eyeGeometry(size * 0.12, size * 0.22)), eyeMat);
    eyes.position.set(0, head.position.y + size * 0.1, head.position.z + size * 0.42);
    this.body.add(eyes);
    // Wings.
    const winged =
      def.shape === 'moth' || def.shape === 'drake' || def.shape === 'owl' || def.shape === 'bird';
    if (winged) {
      const wing = this.geo(wingGeometry(size * (def.shape === 'moth' ? 1.5 : 1.8)));
      for (const side of [-1, 1]) {
        const w = new Mesh(wing, accentMat);
        w.position.set(side * size * 0.5, size * 0.3, 0);
        w.scale.x = side;
        this.wings.push(w);
        this.body.add(w);
      }
    }
    // A trailing tail of glowing beads (hound, fox, wisp, serpent; birds trail a little too).
    const tailCount = serpent ? TAIL + 3 : TAIL;
    this.tail = new InstancedMesh(sphere, serpent ? bodyMat : accentMat, tailCount);
    this.tail.frustumCulled = false;
    this.root.add(this.tail);
    for (let i = 0; i < tailCount; i++) this.trail.push(new Vector3());
    // Halo.
    this.halo = new Sprite(
      this.mat(
        new SpriteMaterial({
          map: haloTexture(),
          color: glow,
          blending: AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0.65,
        }),
      ),
    );
    this.halo.scale.setScalar(size * 3.6);
    this.body.add(this.halo);
    for (const o of [this.root]) o.traverse((c: Object3D) => (c.castShadow = false));
    scene.add(this.root);
  }

  /** Follows a point (the hero's feet) facing `yaw`; `dt` in seconds of game time. */
  update(dt: number, feet: Vector3, yaw: number): void {
    this.time += dt;
    const d = this.def.size;
    // Hover behind the hero's right shoulder.
    const side = 0.9;
    const back = -0.55;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    this.goal.set(
      feet.x + c * -side + s * back,
      feet.y + 1.75 + Math.sin(this.time * 2.2) * 0.12,
      feet.z - s * -side + c * back,
    );
    if (this.lungeT > 0) {
      this.lungeT = Math.max(0, this.lungeT - dt);
      const k = Math.sin((1 - this.lungeT / 0.35) * Math.PI);
      this.goal.lerp(this.lunge, k * 0.65);
    }
    if (!this.placed) {
      this.pos.copy(this.goal);
      this.placed = true;
      for (const t of this.trail) t.copy(this.pos);
    }
    // Smooth follow; velocity kept for facing.
    const k = 1 - Math.exp(-7 * dt);
    this.vel
      .copy(this.goal)
      .sub(this.pos)
      .multiplyScalar(k / Math.max(1e-4, dt));
    this.pos.lerp(this.goal, k);
    this.root.position.set(0, 0, 0);
    this.body.position.copy(this.pos);
    // Face where it is going (or the lunge target).
    const dir = this.lungeT > 0 ? this.dir.copy(this.lunge).sub(this.pos) : this.dir.copy(this.vel);
    dir.y = 0;
    if (dir.lengthSq() > 0.01) this.look.lerp(dir.normalize(), Math.min(1, dt * 6)).normalize();
    this.body.rotation.y = Math.atan2(this.look.x, this.look.z);
    this.body.rotation.x = Math.sin(this.time * 2.2 + 1) * 0.08;
    // Wings flap.
    const flap = Math.sin(this.time * (this.def.shape === 'moth' ? 14 : 9)) * 0.7;
    for (const w of this.wings) w.rotation.z = flap * Math.sign(w.scale.x);
    // Tail beads chase each other.
    const tail = this.tail;
    if (tail !== null) {
      const prev = this.prev.copy(this.pos).addScaledVector(this.look, -d * 0.9);
      const spacing = d * (this.def.shape === 'serpent' ? 0.55 : 0.4);
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        if (t === undefined) continue;
        const to = this.to.copy(t).sub(prev);
        const len = to.length();
        if (len > spacing) t.copy(prev).addScaledVector(to, spacing / len);
        t.y += Math.sin(this.time * 4 + i * 0.7) * 0.004;
        const r =
          d * (this.def.shape === 'serpent' ? 0.5 : 0.28) * (1 - i / (this.trail.length + 2));
        this.m.compose(t, this.q.identity(), this.s.setScalar(Math.max(0.02, r)));
        tail.setMatrixAt(i, this.m);
        prev.copy(t);
      }
      tail.instanceMatrix.needsUpdate = true;
    }
    this.halo.material.opacity =
      0.38 + Math.sin(this.time * 3) * 0.12 + (this.lungeT > 0 ? 0.3 : 0);
  }

  /** Where the pet is now (strike visuals start here). */
  get position(): Vector3 {
    return this.pos;
  }

  /** A short dart toward `target` (a strike). */
  strike(target: Vector3): void {
    this.lunge.set(target.x, target.y + 1.1, target.z);
    this.lungeT = 0.35;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.tail?.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
}

/** Two pointed ears / horns above the head (one geometry). */
function earGeometry(size: number): BufferGeometry {
  const s = size;
  const p = [
    // left
    -0.35 * s,
    0.3 * s,
    0,
    -0.15 * s,
    0.3 * s,
    0.05 * s,
    -0.32 * s,
    0.85 * s,
    -0.15 * s,
    // right
    0.15 * s,
    0.3 * s,
    0.05 * s,
    0.35 * s,
    0.3 * s,
    0,
    0.32 * s,
    0.85 * s,
    -0.15 * s,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}

/** Two small spheres (the eyes) in one geometry. */
function eyeGeometry(r: number, apart: number): BufferGeometry {
  const a = new SphereGeometry(r, 8, 6);
  const b = new SphereGeometry(r, 8, 6);
  a.translate(-apart, 0, 0);
  b.translate(apart, 0, 0);
  const out = new BufferGeometry();
  const pa = a.getAttribute('position').array as Float32Array;
  const pb = b.getAttribute('position').array as Float32Array;
  const na = a.getAttribute('normal').array as Float32Array;
  const nb = b.getAttribute('normal').array as Float32Array;
  const pos = new Float32Array(pa.length + pb.length);
  pos.set(pa);
  pos.set(pb, pa.length);
  const nor = new Float32Array(na.length + nb.length);
  nor.set(na);
  nor.set(nb, na.length);
  const ia = a.index?.array ?? [];
  const ib = b.index?.array ?? [];
  const count = pa.length / 3;
  const idx = new Uint16Array(ia.length + ib.length);
  idx.set(ia);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = (ib[i] ?? 0) + count;
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setIndex(new BufferAttribute(idx, 1));
  a.dispose();
  b.dispose();
  return out;
}

/** A swept wing (fan of triangles) spreading toward +X from the root. */
function wingGeometry(span: number): BufferGeometry {
  const pts: number[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 0.75 - 0.2;
    const a1 = ((i + 1) / n) * Math.PI * 0.75 - 0.2;
    const r0 = span * (0.6 + 0.4 * Math.sin((i / n) * Math.PI));
    const r1 = span * (0.6 + 0.4 * Math.sin(((i + 1) / n) * Math.PI));
    pts.push(0, 0, 0);
    pts.push(Math.cos(a0) * r0 * 0.5, Math.sin(a0) * r0 * 0.25, -Math.sin(a0) * r0 * 0.4);
    pts.push(Math.cos(a1) * r1 * 0.5, Math.sin(a1) * r1 * 0.25, -Math.sin(a1) * r1 * 0.4);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  g.computeVertexNormals();
  return g;
}

let haloTex: CanvasTexture | null = null;

/** A soft round glow (shared by every pet). */
function haloTexture(): CanvasTexture {
  if (haloTex !== null) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g !== null) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  haloTex = new CanvasTexture(c);
  return haloTex;
}
