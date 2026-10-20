# Asset list (real characters and animations)

Every character in the game is a procedural rig built in code (sculpted body, outfit, armor,
cloth on spring bones; one skinned mesh per character, Mixamo bone names). This page lists what
real, artist-made assets would replace them. **Nothing here is needed to play.**

**Status: the loader for real models is not implemented yet** (selecting a `gltf` visual in
`src/data/heroes.ts` currently throws a clear error). It will be built when the first files are
uploaded, so it can be tested against real files instead of guesses.

## Where the files come from

- **Mixamo** (<https://www.mixamo.com>, free with an Adobe account; check its current terms of
  use for commercial games before shipping). It provides rigged humanoid characters and
  animation clips.
- Mixamo downloads are **FBX**. You don't need a PC: three.js includes an `FBXLoader`
  (`three/examples/jsm/loaders/FBXLoader.js`), so the game can load the FBX files directly.
  glTF (`.glb`) also works if you have another way to convert.
- Do not download anything that needs my login. You upload the files to the repository
  yourself: on the GitHub website (desktop mode in the phone browser) → the folder below →
  **Add file → Upload files**.

## Download settings

- Characters: **FBX Binary**, **T-pose**, "With Skin".
- Animations: **FBX Binary**, **Without Skin**, 30 fps, "In Place" ticked for
  locomotion loops (the game moves the character itself).
- One file per clip. Keep the file names below so the data change is one line.

## Characters (`public/assets/models/`)

Pick any Mixamo character whose look fits. Names below are what to search for; the exact
character is your choice.

| File          | Replaces                                   | Search ideas                |
| ------------- | ------------------------------------------ | --------------------------- |
| `kael.fbx`    | Kael (dual blades)                         | hooded rogue / assassin     |
| `brann.fbx`   | Brann (greatsword)                         | armored knight / paladin    |
| `lyra.fbx`    | Lyra (bow + dagger)                        | ranger / archer             |
| `thrall.fbx`  | Hollow Thrall                              | zombie / ghoul              |
| `brute.fbx`   | Ashen Brute                                | ogre / mutant / large brute |
| `bulwark.fbx` | Bulwark Sentinel                           | knight with shield          |
| `seer.fbx`    | Ember Seer                                 | mage / sorcerer in robes    |
| `warden.fbx`  | The Hollow Warden (boss, shown 2.5× scale) | dark knight / armored giant |

Imps, the Cinder Wretch, Mother of Ash (wings) and The Bound King (extra arms) keep procedural
bodies until suitable models exist; Mixamo humanoids have no wings or extra arms.

## Animations (`public/assets/animations/`)

Search terms (Mixamo's clip titles vary; pick the closest match and keep my file name):

| File                                | Used for                  | Search term                              |
| ----------------------------------- | ------------------------- | ---------------------------------------- |
| `idle_combat.fbx`                   | idle stance               | "sword idle" / "fighting idle"           |
| `run.fbx`                           | locomotion                | "run" (sword or unarmed), In Place       |
| `dodge_roll.fbx`                    | dodge forward             | "roll" / "dodge roll"                    |
| `dodge_back.fbx`                    | dodge back                | "dodge backward" / "back step"           |
| `slash_1.fbx` … `slash_5.fbx`       | Kael combo                | "sword slash", "dual blade attack"       |
| `gs_slash_1.fbx` … `gs_slash_4.fbx` | Brann combo               | "great sword slash"                      |
| `gs_charge.fbx`                     | Oathbreaker hold          | "great sword high attack" (wind-up held) |
| `bow_shoot.fbx`                     | Lyra shots                | "standing draw arrow" / "archery"        |
| `backflip.fbx`                      | Snare Leap                | "backflip"                               |
| `spin_attack.fbx`                   | Blade Gyre / spins        | "spin attack" / "sword spin"             |
| `hit_react.fbx`                     | hurt (additive)           | "hit reaction"                           |
| `knockdown.fbx` + `getup.fbx`       | knockdown                 | "knocked down", "getting up"             |
| `death.fbx`                         | death                     | "dying"                                  |
| `roar.fbx`                          | boss intro / phase change | "roar" / "taunt"                         |
| `cast.fbx`                          | Seer casting              | "magic attack" / "spell cast"            |

## What changes when they arrive

1. Implement the FBX/glTF visual path (load, retarget clip names to the game's clip ids).
2. Change one line per hero in `src/data/heroes.ts`, e.g.
   `visual: { kind: 'gltf', url: 'assets/models/kael.fbx', scale: 1 }`.
3. Re-run the self-tests (draw calls stay low: one skinned mesh per character).
