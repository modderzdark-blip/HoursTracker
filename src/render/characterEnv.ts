import {
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

let current: Texture | null = null;

/**
 * A small moody reflection environment for character materials (metal armor and blades need
 * something to reflect or they render black): a dark room lit by a warm ember glow from below,
 * a cool violet sky panel behind and a soft key panel above-front. Pre-filtered once with PMREM.
 */
export function createCharacterEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  const room = new Mesh(
    new BoxGeometry(20, 12, 20),
    new MeshBasicMaterial({ color: new Color(0.16, 0.15, 0.18), side: BackSide }),
  );
  scene.add(room);
  const panel = (
    color: Color,
    w: number,
    h: number,
    pos: [number, number, number],
    rotX: number,
    rotY = 0,
  ): void => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color, side: BackSide }));
    // Linear HDR colours (> 1) so the pre-filtered highlights stay bright after blurring.
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rotX, rotY, 0);
    scene.add(m);
  };
  // Ember floor glow (warm, from below), cool sky behind, soft key above-front-left, side fill.
  panel(new Color(2.4, 0.9, 0.3), 14, 14, [0, -5.5, 0], -Math.PI / 2);
  panel(new Color(0.8, 0.78, 1.5), 16, 6, [0, 3, -9.5], 0);
  panel(new Color(6, 5.5, 4.8), 8, 6, [-4, 5.5, 4], Math.PI / 2);
  panel(new Color(1.2, 0.75, 0.7), 6, 8, [9.5, 0, 0], 0, -Math.PI / 2);
  panel(new Color(0.5, 0.48, 0.58), 20, 12, [0, 0, 9.9], 0, Math.PI);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      (o.geometry as BufferGeometry).dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
  });
  return target.texture;
}

/** Environment used by every character material created after this call. */
export function setCharacterEnvironment(tex: Texture | null): void {
  current = tex;
}

export function getCharacterEnvironment(): Texture | null {
  return current;
}
