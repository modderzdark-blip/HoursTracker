# Changelog

## [0.13.2] — Lighter Ultra, same picture (2026-10-30)

### Changed

- **Ultra and High do less graphics work per frame, with the same look.** Measuring showed
  the boss arenas are not heavier than the others in objects or game logic (the game's own
  code is about 3% busy). The cost is the graphics chip running Ultra's full-screen effects at
  high resolution, and on phones that is mostly memory traffic. So:
  - Tone mapping and colour grading are one pass instead of two, with the same maths.
  - Ambient occlusion darkens the picture in place instead of copying the whole frame first.
  - The Ultra shadow map is 3072 instead of 4096, a quarter of its memory traffic less. Its
    softness is scaled to match, so shadows look the same, and still sharper than High.
  - Before and after screenshots at Ultra match: the menu scene differs by 0.05 out of 255,
    which is just film grain.

## [0.13.1] — Closer fights, faster start (2026-10-30)

### Fixed

- **Enemies and bosses start close again.** Since the arenas grew in 0.10, waves started
  about 23% further away. The hero, enemies and boss now start at their original spots, 5 to
  7 m closer. A spot now covered by the bigger architecture moves out just enough to stand
  clear.
- **Faster startup.** Timing showed the wait is the graphics driver building shaders, mostly
  the hero's material, not the engine download or the physics.
  - The menu's shaders now build in parallel in the background, so the title stays
    responsive.
  - Release builds no longer stop to check each shader for errors.
  - In testing, startup was 20 to 25% faster.
  - The first launch after an update is still the slowest: Android keeps built shaders, so
    later launches are quicker.
- A `[boot]` line in the debug log shows how long physics, app setup and shaders took.

## [0.13.0] — Abilities, true ultimates, runes (2026-10-30)

### Added

- **Ability loadout:** every hero has six abilities, and you pick any three for buttons I, II
  and III.
  - 24 new abilities, 3 per hero, unlocking at hero level 4, 9 and 15.
  - Kael: Hollow Fan, Eclipse Cross, Shade Mirage.
  - Brann: Whirlwind Cleave, Warlord's Roar, Sunder Leap.
  - Lyra: Hunter's Spread, Rain of Thorns, Lunar Dagger Dance.
  - Garrick: Hammer Quake, Shield Throw, Sanctuary.
  - Seraphine: Flame Barrage, Inferno Ring, Phoenix Wall.
  - Ryn: Rising Dragon, Thousand Palms, Phantom Kick.
  - Valka: Storm Javelin, Chain Lightning, Valkyrie Charge.
  - Morrow: Soul Harvest, Bone Cage, Grave Pulse.
  - The Skills screen has a new **Abilities** tab: your three buttons, every ability with what
    it does (leap, ranged, area, burn, life drain…), its damage and cooldown, and the level it
    unlocks at. The talent tree is the second tab, and its branches follow whatever ability is
    on that button.
  - Every ability has its own icon (48 icons from game-icons.net), shown in the tab and on the
    battle buttons in the hero's colour.
- **Enchant runes:** reaching +3, +6 and +9 grants a rune with a real combat effect: combo
  damage, crit, life drain, ability damage, counters, dodge or ability cooldowns, ultimate
  charge or ultimate damage. Each slot has its own rune pool. Later runes are stronger, and
  runes only work while the item is worn.
- **Enchant ritual:** the stone sinks into a turning rune circle around the item, then it
  flares in the new tier's colour and names any new rune, or the stone cracks.

### Changed

- **Ultimates are far bigger:**
  - Every hero now summons a shadow army of at least three copies of themselves, which strike
    around enemies during the ultimate.
  - The moment the last blow lands, a finale fires: a 9 m blast that launches everything,
    with a ring of light columns, a nova, ground cracks, shadow echoes, a flash in the hero's
    colour, heavy shake and slow motion. Its damage grows with your ultimate bonuses.
  - The cast opens with a column of light and rings closing in on the hero.
- **Enchanted gear glows by tier:** blue (+1 to +3), violet (+4 to +6), gold (+7 to +9), and
  radiant at +10.

## [0.12.3] — Ultra cut-scenes fixed (2026-10-28)

### Fixed

- **The black screen during cut-scenes on Ultra graphics:** match intro, wave kill cams,
  ultimates and Victory.
  - On Ultra, the cut-scene blur ran after the ambient-occlusion shadows. It then read the
    depth image of the very picture it was drawing into, which graphics chips forbid. Phones
    showed black for the whole shot. The blur now runs first, so that can't happen.
  - Found from the player's report that it only happened on Ultra. Reproduced in Chrome, which
    logged "Feedback loop formed between Framebuffer and active Texture" on every cut-scene
    frame. After the fix there are no errors and no dark frames.
  - Nothing looks different apart from the black frames being gone.

## [0.12.2] — The real black-screen fix (2026-10-28)

### Fixed

- **No more one-second black screen** at match start, new waves, ultimates and Victory. 0.12.1
  did not fix it, because the cause was not the screen effects. These were the real causes:
  - **Dynamic resolution resized the 3D picture in the middle of a fight**, and those were
    always the heaviest moments. On Android a resize clears the picture to black, and the next
    frame (rebuilding the graphics buffers) can take a second.
    - Resolution now changes only between fights: the game measures how a fight ran and
      adjusts the next one while the loading screen is up.
  - **The quality auto-detect ran again after every update.** It changes graphics settings
    during a fight, which causes the same black.
    - It is back to running once, on first install.
  - **The first frame of a fight was drawn after the loading screen lifted.** The screen
    effects (bloom, colour grading, the cinematic blur) were set up only then, and the blur
    first appeared at the first cut-scene.
    - All of them are now prepared and drawn while the loading screen still covers the screen.
- The 3D graphics quality is unchanged.

## [0.12.1] — Black screen fix (2026-10-28)

### Fixed

- **The screen no longer turns black behind the text** at the start of a wave, at Victory and
  during an ultimate on Android phones. These moments created more screen layers than the
  phone's graphics memory allows, and Android paints the layers it cannot fit as black:
  - The ultimate's glow was a huge layer (45 MB on a typical phone), and it stayed on screen,
    invisible, for the rest of the fight. It is now screen-sized and switches off once it has
    played.
  - The ultimate glow, the cut-in's moving lines and the shine on VICTORY no longer use blend
    modes, which Android WebView cannot mix with the game picture.
  - During cinematic moments, the touch controls and damage numbers hide instantly instead of
    fading. Fading a full-screen layer makes the phone keep a full copy of it in memory.
  - Peak overlay memory at these moments dropped from about 123 MB to 88 MB. The 3D graphics
    are unchanged.
- During cinematic moments the touch controls go see-through but still take touches, so a
  thumb already on the joystick keeps working when the shot ends.
- **Small phones:**
  - The Gear screen's relic slots no longer overlap the gear tiles.
  - The relic slots are now big enough to tap easily.
  - The item window's enchant panel is now one compact line under the stats, so the Equip,
    Upgrade and Salvage buttons stay on screen.

## [0.12.0] — Relics, enchanting and ultimates (2026-10-27)

### Added

- **Relics:** ten ancient artifacts for two account-wide relic slots.
  - Each gives a stat bonus and one signature effect: ultimate damage, faster ultimate charge,
    life drain, shorter cooldowns, crit, combo or skill damage, or stronger perfect-dodge
    counters.
  - They come from Reliquary caskets in the Shop.
  - A duplicate raises the relic's level, up to 5. A duplicate of a maxed relic turns into
    souls.
  - There is a new Relics screen, and two relic slots on the Gear screen.
- **Enchant Stones and enchanting:**
  - Rare or better gear can be enchanted up to +10, for +6% to all its stats per level.
  - From +3 onward an attempt can fail. The stones are spent, but the item never loses a level.
  - Stones are hard to get on purpose. Bosses drop one only sometimes (6% on Normal, 10% on
    Hard, 15% on Nightmare). The Shop sells at most one per offer per day: for gems, for souls,
    or for tickets.
- **More in the Shop:**
  - New Relics and Enchant tabs.
  - Four new daily deals (stone, relic casket, a warlord bundle, a gold feast).
  - Four daily deals instead of three.

### Changed

- **Ultimates hit 60% harder.** The hero also cannot be hurt while an ultimate plays.
- **Ultimates are cinematic:**
  - Black bars close in.
  - A band in the hero's colour sweeps across the screen with their name and the move's name.
  - The world slows for a beat and the camera shakes.
  - With Reduce flashes on, the band stays calm (no speed lines or glow).
- **Smoother battles on phones:**
  - Battles now watch the real frame rate. When it drops below the target (60 FPS, or your cap
    if it is lower), the render resolution steps down a little at a time, and it climbs back
    when there is headroom. The lowest step is 62%.
  - Very sharp screens use FXAA instead of 4× MSAA.
  - The quality auto-detect runs again after each update.

## [0.11.1] — New icons (2026-10-27)

### Changed

- **Every icon redone from scratch.** Menu, currency, gear, mode and pet icons now use detailed
  game-icons.net art (CC BY 3.0, credited in public/assets/CREDITS.md), drawn with a dark
  outline, a metallic gradient and a gloss highlight. Gear icons take their rarity colour, and
  each pet has its own creature icon.
- **New app icon and splash screen:** a gold sword rising from flames on an ember glow,
  replacing the default Capacitor icon.

### Fixed

- The shine on buttons and on the Victory title no longer spills outside its frame.
- The level number and "LV" on the hub badge no longer overlap.

## [0.11.0] — Companions and coin (2026-10-27)

### Added

- **Pets**: eight original companions, from rare to mythic:
  - Cinder Pup, Gloom Moth, Ashwing Drake, Hollow Owl, Ember Fox, Bone Wisp, Pyre Phoenix and
    Void Serpent.
  - Each gives a stat bonus to your hero.
  - The pet you take with you follows you in battle as a glowing creature and strikes the
    nearest foe every few seconds.
  - Pets level up with souls and gold; duplicates become shards that add stars.
- **Shop**, with in-game currency only (no real money):
  - A free daily tribute and three daily deals that change every day.
  - Iron, Ember and Abyss gear chests.
  - Ember and Abyss pet eggs, with their odds shown.
  - A currency exchange.
  - Each purchase shows what you got.
- **Auto-equip**: wear the strongest free item in every slot with one tap.

### Changed

- **New icon set**: drawn, two-tone icons for currencies, gear slots, modes and menus replace
  the emoji and symbols everywhere.
- **Gear screen rebuilt**:
  - Your six slots sit around a hero card showing power and key stats.
  - The bag has filter chips with icons, sorting by rarity, power or level, and tiles that
    glow in their rarity colour.
  - A green arrow marks items that beat what you wear.
- **Item panel**: item power, an upgrade success bar, and costs shown with currency icons.
- **Every screen restyled**:
  - Bevelled buttons and framed panels.
  - Hero medallions and skill rank pips.
  - Rewards shown as icons in the Journal, daily gifts and the pre-battle panel.
- **Main menu dock**: Heroes, Gear, Pets, Skills, Quests and Shop. Settings is now the cog
  next to the Ember Hearth.

## [0.10.0] — Wider halls, smoother frames (2026-10-27)

### Added

- **Each arena has its own architecture** (procedural, built from the arena's scanned stone):
  - The Ashen Wastes: a colossus' ribcage arching over the fire, a standing-stone circle and an
    obelisk.
  - The Bound Spire: pointed gothic arcades down both aisles.
  - The Hollow Deep: stalagmite fields.
  - The Gravewood: graves, sarcophagi, a columned mausoleum and a chapel ruin.
  - Cinder Court and Ash Gate: a cathedral ruin, obelisks, an aqueduct and a broken colonnade.
  - The Drowned Cloister: the abbey church wall.
  - Widow's Pass: an old arched bridge.
- **Endless chapters are always visible**: the chapter map shows the next chapters as locked
  previews (∞ on the endless ones, with a banner), and the hub has an Endless tile.
- **Frame rate**: new 120 and Max (uncapped) choices. The Android app asks the screen for its
  highest refresh rate.

### Changed

- **Every arena is about 30% bigger**: the open space, the walls and the architecture all grow;
  crates, barrels and lanterns keep their real size.
- **New main menu**:
  - A large Adventure card shows your chapter, the next stage, chapter progress and a play
    button.
  - The other modes are tiles with icons.
  - Hero panel with a level badge, power and arrows to switch heroes.
  - Dock buttons and the Ember Hearth have icons.
  - The title screen has a painted backdrop.
- The FPS cap defaults to 120. Saves still on the old 60 default move to 120; a 30 cap is kept.

### Fixed

- **The random screen flash during fights**: distant lightning no longer brightens the scene
  lights, and it only strikes during cinematic shots.

## [0.9.0] — Endless Ash: real places, story and spectacle (2026-10-27)

### Added

- **Endless Adventure**: past chapter 4, chapters keep coming forever, each with its own name,
  lore, foes, arenas, an elite and a boss; the stage map gets a chapter selector.
- **Five new bosses**: Morvane the Headsman, Vaelith the Bone Cantor, Gharox and Ruul the Twin
  Maw, Xyrith the Ossuary Queen and the Hollow Twin, also in the Demon Tower, Boss Challenge,
  Hunts and the Dungeon.
- **Elite affixes** (Ironclad, Bloodsworn, Cinderburst, Quickened, Warded, Frenzied, Hulking)
  stack on enemies and bosses deeper down; deeper chapters pay more.
- **Three new arenas**: The Gravewood, Widow's Pass and The Drowned Cloister.
- **Scanned real-world assets** (CC0, Poly Haven, fetched by CI and made phone-ready by
  tools/assets/process.mjs): 2K PBR surfaces and 40+ props — castle walls and towers, statues,
  gates, fire pits, barrels, weapon racks, trees, roots, cliffs and mountains.
- **Story**: a skippable prologue, chapter intro cards, a chapter-complete moment, lines from
  every boss and hero.
- **Cinematics**: stage fly-overs that settle on the hero, boss intro and death cinematics, kill
  cams, per-hero ultimate cams, a livelier battle camera.
- **Ultra graphics** above High: ambient occlusion, softer shadows, full 2K textures, cinematic
  depth of field, film grade, stronger character lighting.
- **Combat feel**: combo ranks, multi-kill and streak callouts, finisher hit-stop, bigger crits,
  low-health heartbeat, ultimate-ready burst.
- **Rewards**: victory sequence with stars, counters, XP bar with level-up, card-by-card loot
  reveal; unlock celebrations; encouraging defeat screen with advice.
- **Progress**: next-goal hint, red dots for things to do, animated currencies, power roll-ups,
  quest/achievement toasts, road travelled on the stage map; menu transitions and a loading
  screen; procedural stingers for all of it.
- **Animation**: enemies burn away into embers and form out of ash; personalities per enemy;
  directional hit reactions, knockdowns and deaths; idle variants, class dodges and victory poses
  for every hero; richer creature motion.

### Changed

- All five original arenas rebuilt as places with shaped edges, terraces, set pieces and
  backdrops instead of walled circles.
- Low quality drops small scattered props and loads textures at 512 px.
- "Reduce flashes" also turns off full-screen combat flashes.

## [0.8.0] — Heroes, Monsters & Spectacle (2026-10-20)

### Added

- **Five new heroes** (8 in all), each with its own body, weapon, idle stance, poses, combo,
  three skills, an ultimate with layered colour-matched effects, and a skill tree:
  - **Garrick, the Iron Bastion** (tank, tower shield + warhammer): shield bashes and slams,
    Rampart Charge, Challenge Roar (drags nearby enemies in and slows them), Iron Vigil (a
    steerable guard stance taking 70 % less damage), ultimate Bastion Fall. Unlocks after 2-4.
  - **Seraphine, the Ember Witch** (fire staff): fire-bolt combo ending in an exploding fireball,
    Cinder Wave, Frost Nova, Starfall Brand, ultimate Pyre of Heaven (meteor storm). After 2-8.
  - **Ryn, the Ashfist** (bare fists): six-hit punch-and-kick combo with short dashes, Comet Kick,
    Cyclone Heel, Skybreaker Palm (launcher), ultimate Hundred Ash Fists. After 3-4.
  - **Valka, the Storm Lance** (spear): long thrusts and sweeps, Thunderdive (leaps onto the
    target), Piercing Gale, Tempest Wheel, ultimate Skyfall Lances. After 3-8.
  - **Morrow, the Gravecaller** (scythe + grave magic): reaps and soul orbs that drain life,
    Grave Tithe (life-drain zone), Hex Rupture, Wraith Orbs, ultimate Ossuary Bloom. After 4-4.
- Move data: `special: 'leap'`, guard stances (`damageTakenMult`), life drain and pulling hits.
- Arena opponents can be any of the eight heroes.
- Tests: data, balance against the original heroes, unlocks, and real-physics fights for every
  new move; the UI audit visits the last hero on the Heroes screen.
- **Effects library**: glowing slash arcs that follow the swing, expanding shockwaves, light
  pillars, burning ground fissures, energy novas, impact flashes, smoke, screen flashes and
  colour fringing. Skills and enemy attacks list their effects as data; plain melee swings get
  slash arcs shaped by the swing automatically.
- **Effects light up the arena**: explosions, slams, novas and big deaths flash a real light
  on the floor, walls and characters around them (Medium/High).
- **Moonlight shafts**: soft beams with drifting dust slant down into every arena
  (Medium/High).
- **Scorch marks**: big ground effects and boss deaths leave charred, ember-speckled marks that
  fade over several seconds.
- **New enemies** with bullet patterns that are busy but readable: Ember Wisps (fans of fire
  orbs), Hex Wisps (rotating rings and spirals of hex orbs), Gloom Bats (diving swarms),
  Hexcallers (curse eruptions under your feet, homing bolts), Revenants (fast double cuts and
  lunges) and Magma Golems (expanding quake rings, thrown fireballs). Some swarm enemies attack
  freely instead of waiting for their turn.
- Every stage, Dungeon room and Tower floor mixes the new enemies in.

### Changed

- The Heroes screen lists the roster in two columns so all eight fit on a phone.
- **Skills and ultimates of Kael, Brann and Lyra redesigned** with new names and effects:
  Phantom Rush (a longer dash that ends in a burst), Blade Tempest, Umbral Execution, Night of a
  Thousand Blades; Titan Fault (the ground splits ahead and erupts far away), Juggernaut (ends
  in a shockwave), Cataclysm; Starpiercer, Starfall Volley, Moonlit Snare.
- Bloom (glow) now also runs on Medium quality.
- "Tap to begin" and the mid-screen wave banner are truly centred on every screen, including
  phones with notches.

## [0.7.0] — Graphics overhaul (2026-10-20)

### Changed

- **Arenas rebuilt**: every surface is a high-resolution PBR material (colour, normal,
  occlusion/roughness) made on the GPU when the arena loads: cut flagstones with uneven, chipped,
  sunken and missing stones and dirty joints, cracked earth, ashlar masonry, layered rock, wet
  cave stone with reflective puddles; floors blend in patches of a second surface. Props are
  sculpted: noise-carved boulders, fluted columns built to their real size, broken stumps,
  buttressed ruined walls, fallen drums, rubble, bones and skulls, cave stalagmites, a cliff ring
  and distant peaks, all with baked shading in the crevices.
- **Sky and atmosphere**: sky dome with moon, stars and drifting clouds (a dark vault in the cave),
  animated fire on braziers and new wall torches, low drifting mist, and a colour-grading pass
  (cool shadows, warm highlights, contrast, vignette, film grain) on Medium and High.
- **Hub**: the hero stands on a carved dais in a moonlit ruined shrine with columns, braziers,
  cliffs and mist.
- **Characters**: cloth folds and weave, leather grain and creases, dented and scratched metal
  with uneven polish, and grime toward the feet, generated on the surface (fades out at a
  distance so nothing shimmers).

### Added

- Dev arena viewer (`/dev/arena-viewer.html` with `npm run dev`); test hook `setQuality`.
- Tests: environment shapes (validity, baked occlusion, triangle budgets, column proportions).

## [0.6.0] — Beasts, Hunts & Settings (2026-10-20)

### Added

- **Creature bosses** (non-humanoid bodies with their own skeletons and procedural animation):
  **Gorgrath, the Ash Behemoth** (bite, claw rake, charge, fire breath, rearing stomp, howl for
  hounds, pounce), **Vexmora, the Brood Weaver** (bite, leg stab, web volley that slows, venom
  pools, broodling swarm, pounce) and **Ssarveth, the Cinder Wyrm** (strike chains, tail sweep,
  fireball spit, fire breath, and a burrow: it sinks out of reach, tunnels to you and erupts).
- **Creature enemies**: Ash Hounds (fast lunges) and Broodlings (small spiders in packs).
- **Chapter 4 — The Hollow Deep**: 8 stages (levels 25–32) in a new cavern arena with the three
  creature bosses (4-4, 4-6, 4-8). It is the grind chapter: it expects epic gear.
- **Hunts** (after 1-4): every day three defeated bosses are marked, each twisted by one or two
  omens (Ironhide, Brutal, Swift, Swarming, Glass Fury). Hunt rank grows with every hunt won;
  marks scale up to your progress; Hard-quality loot, gems on the first kill of the day.
- The Demon Tower and Boss Challenge include the new bosses, enemies and arena.
- **Settings screen** with sections (Camera, Graphics, Controls, HUD & accessibility, Audio,
  Gameplay); every option applies immediately and is saved; old saves get defaults.
- **Camera**: distance presets + fine slider, angle (low / normal / high), field of view,
  follow smoothness, look-ahead, screen shake 0–150 %, live side-view preview, reset camera.
  The pause menu has camera distance and screen shake quick settings.
- **Graphics**: resolution scale (50–100 %), shadows / bloom overrides, particle density,
  FPS counter.
- **Controls**: joystick size, dead zone and fixed / floating mode; auto-aim on/off and range;
  attack magnetism on/off; vibration strength.
- **HUD & accessibility**: combo counter on/off, HUD scale (90–130 %), reduce flashes (no
  pulsing HUD effects, softer bloom), larger menu text, colour-blind-friendly telegraphs.
- **Audio**: UI sounds on/off, mute in background on/off.
- **Gameplay**: confirm before salvaging rare+ gear, defeat-screen tips on/off, and a
  confirmed "Reset all settings" (progress is never touched).

### Changed

- The wave line on the battle HUD is centred in the visible area (camera cut-outs, letter
  spacing).
- Deeper chapters pay more XP (+15 % per chapter after the first) so heroes keep pace.
- The boss intro camera frames bosses by their real height.
- Tests: 290 unit/integration tests (creature geometry and animation, creature boss fights,
  burrow, summons, hunts, settings); the UI audit covers Chapter 4, Hunts and every settings
  section.

## [0.5.0] — Look & feel (2026-10-20)

### Changed

- **Characters rebuilt**: smooth bodies that bend at the joints (no more stiff capsule parts),
  draped hoods, helms with glowing visors, crowns, horns, plate armor, leather straps, robes,
  rags and fur; bevelled blades, a recurve bow, heater shield, flanged mace, gnarled staff.
  Capes, scarves, tabards, loincloths, tails and bat wings swing on spring bones. Metal shines
  (per-vertex roughness/metalness + a reflection environment), fronts are lit by a camera fill,
  and every character has its own outfit and a readable palette.
- **Running**: feet no longer slide; the step rate follows the actual speed and the run cycle
  has real contact / pass / flight phases.
- **Combat**: combo hits lunge to reach the enemy you aim at (and never run through a close
  one); the camera is closer (7.6 m instead of 9.3 m); the hub frames the hero closer.
- **UI**: every menu, modal and the battle HUD were fixed for overlaps, clipped text and
  off-screen content on small phones and tablets; text is at least 12px; floating combat
  numbers stack instead of drawing over each other; no mid-fight graphics toast.

### Added

- Dev-only character viewer (`/dev/rig-viewer.html` with `npm run dev`).
- Tests: rig geometry/weights/triangle budgets/cloth stability, run-cycle foot planting, attack
  magnetism, and a UI layout audit (35 screen states × 3 sizes in CI, 6 with `UI_AUDIT_ALL=1`).

## [0.4.0] — Progress & polish (2026-10-19)

### Changed

- **Balance**: heroes now keep pace with the stages (XP curve 40 × L^1.3, more XP per stage,
  more Dungeon / Tower / Challenge XP); enemies gain less HP and DEF per level; boss HP lowered
  (Bound King 13000 → 7200, Mother of Ash 11000 → 8000, Warden 9000 → 7800, Penitent 5200 →
  4300). The Bound King's sweep is narrower and slower, the grab rarer and softer, slam and
  eruptions weaker, phase hazards rarer, phase multipliers lower. On first clears only, the
  final boss went from ~370 to ~140 average hits; recommended power follows the new curve.
- **Animation**: torso banks into turns and leans with acceleration; hits snap the body away
  from where they land; attacks (heroes and enemies) have anticipation, a snappy strike and
  follow-through; the run cycle bobs and twists; idle shifts weight.

### Added

- **Journal**: 3 daily quests + all-done chest, 7-day login calendar (pops up once a day),
  10 tiered achievements (gems).
- **Ember Hearth** on the hub: gold, XP and materials build up over real time (12 h cap).
- **Ember Blessing**: +10% ATK / +12% HP per defeat on a stage (max 3) until it is cleared;
  shown on the pre-battle panel, the defeat screen and in the battle label.
- **Bench XP**: unlocked heroes you are not playing earn 40% of the XP.
- Tests: balance guard, quests, login, hearth, blessing, achievements, body dynamics, strike
  keys (216 unit tests); e2e for the daily gift and the Journal (13 e2e).
- **Release signing (M15, optional):** with the `ASHBOUND_*` secrets set, the Android workflow
  also builds a store-signed APK + AAB as a workflow artifact. Skipped without them; the preview
  build is unchanged. UNTESTED (no secrets configured).

## [0.3.0] — Full game loop (2026-10-19)

### Added

- **Hub**: 3D hero preview, game modes, Heroes / Gear / Skills / Settings, currency bar.
- **Adventure**: 3 chapters × 8 stages (Ashfall March, The Smoldering Wastes, The Bound Spire),
  stage map with stars, pre-battle panel (foes, rewards, recommended vs. your power), Normal /
  Hard / Nightmare per chapter, victory screen with loot reveal, next-stage flow.
- **Progression**: hero levels (XP curve in data), gear in 6 slots × 5 rarities with random
  substats, upgrades +1…+15 (success rate drops above +10, nothing is ever destroyed), salvage,
  locking, bulk salvage, Ember Cache (reward tickets → rare+ item), drop tables per stage and
  difficulty with epic/legendary pity, skill trees per hero (power, haste, modifiers, core).
- **Heroes**: Brann (greatsword, super armor, hold-to-charge Oathbreaker, Earthsplitter
  shockwave, Bulwark Rush, Meteor Cleave) and Lyra (bow at range / dagger up close, Piercing
  Gloam, Ashfall Volley rain, Snare Leap trap, homing Gloamstorm), unlocked with souls.
- **Enemies**: Bulwark Sentinel (front shield — flank or stagger it), Ember Seer (kites, bolts,
  ground eruptions), Cinder Wretch (rushes in and explodes).
- **Bosses**: Mother of Ash (claws, fire breath, takes flight and rains fireballs, summons
  adds), The Bound King (sweeps, slams, a grab you must dodge, timed arena eruptions);
  mini-bosses The Gaoler, The Seer Exalted, The Iron Penitent.
- **Modes**: Dungeon (random chambers, HP carry-over, elite, timed entries), Demon Tower
  (endless floors, boss every 10th, milestones), Boss Challenge (10 tiers per boss), Arena
  (AI duelists built from hero + gear + skills, rating, weekly seasons with rewards, local
  leaderboard).
- **Combat systems**: pooled projectiles and ground zones, shields / blocking, kiting AI,
  summons, boss flight and grabs, hazards; camera pulls back for huge bosses.
- **Settings**: button size and opacity, left-handed layout, screen shake, damage numbers,
  volumes (master / effects / music), vibration, graphics, FPS cap.
- **Music**: procedural soundtrack (hub, battle, boss themes).
- **Save v3** with migration from v2 (wallet and settings kept).
- 193 unit/integration tests in 15 files; 12 Playwright smoke tests rewritten for the hub flow.

### Changed

- Each battle builds its own scene and physics world and is disposed afterwards.
- Enemy stats scale with stage level and difficulty; heroes with level, gear and skills.

## [0.2.0] — Gameplay prototype (2026-10-18)

### Added

- **Animation:** procedural skinned placeholder rigs (one SkinnedMesh + glow mesh per character,
  Mixamo bone names, weapon sockets) for Kael, Thrall, Imp, Brute, the Hollow Warden and a
  training dummy; AnimationMixer controller with pose-built clips, crossfades, clip events,
  additive hurt reactions and head look-at.
- **Combat:** data-driven damage formula with crits, defence, difficulty and bonuses; health,
  poise/stagger, knockback/knockdown, status effects (bleed stacks, burn, slow); ActionRunner
  with startup/active/recovery, cancel windows, i-frames and root-motion-style move curves;
  Rapier shape queries + precise arc/circle/box hit tests; hit-stop, shake, sparks, damage numbers.
- **Hero Kael:** 5-hit combo with 150 ms input buffer, dodge with i-frames and perfect-dodge
  slow-mo + counter (×1.5), skills Rending Dash, Blade Gyre (steerable spin), Umbral Step
  (shadow step, guaranteed crit), ultimate Hollow Legion (shadow clones), weapon trails.
- **Enemies:** Thrall (chop), Imp (fast pounce, can burn), Brute (slam + sweep, heavy poise); AI state machine with
  telegraphs, attack tokens (max 2 attackers on Normal), whisker obstacle avoidance, crowd
  separation; pooled roster.
- **Boss — The Hollow Warden:** cinematic intro, 3 phases (flaming weapon from phase 2),
  phase-change shockwave push, locked-target leap, break bar with stun and damage bonus, enrage timer, boss HP bar.
- **Stage flow:** The Cinder Court — 12 s practice countdown with a training dummy, 3 waves,
  boss, victory screen with 1–3 stars (clear / no revive + low damage / par time), rewards;
  defeat screen with one gem revive per run.
- **Save v2:** wallet (gold, gems, souls, materials, tickets) + stage records, v1 → v2
  migration (20 starting gems so revive can be tried).
- **Audio:** procedural Web Audio SFX (swings, hits, crits, hurt, dodge, perfect dodge,
  skills, ultimate, telegraphs, slams, boss roar, soul pickup, break, victory/defeat).
- **Android APK:** Capacitor 8 project, `android-preview.yml` builds a signed debug APK on every
  push and publishes it to the `ashbound-preview` pre-release; an emulator job boots it and
  attaches screenshots + WebView console.
- **Debug:** cheats God, Kill, Boss, -50% boss HP; test hook `window.__ashbound`; all battle
  shaders precompiled at load.
- **Tests:** 139 unit/integration tests, 10 Playwright smoke tests incl. full boss run,
  defeat/revive and 60 s soak.

### Changed

- The M1 test arena mode and capsule hero are replaced by the battle mode and skinned rig.
- The debug overlay is click-through (only its cheat buttons take touches); the corner gesture
  counts taps by gap (3 taps, ≤ 1 s apart).

### Fixed

- Boss HP bar no longer overlaps the player HP bar on narrow screens.
- Training dummy is removed when waves or the boss intro start.
- Enemy eyes were hidden inside the head.

## [0.1.0] — M1 Foundation (2026-10-18)

### Added

- Vite 8 + TypeScript 6 (strict) project, ESLint 10 + typescript-eslint, Prettier, Vitest 5,
  Playwright 1.56 (Pixel 7 landscape, real CDP multi-touch).
- GitHub Pages workflow: typecheck, lint, format check, unit tests, build, deploy on every push
  to `main` / `ccr-*`.
- Core: typed allocation-free event bus, service registry, fixed-timestep loop (60 Hz logic,
  interpolated render, max 5 sub-steps, spiral-of-death protection), time control (hit-stop,
  slow motion), FPS cap limiter (30/60, works on 60/90/120 Hz panels), game clock.
- Input: floating virtual joystick (dead zone, response curve, base follows thumb), ATTACK /
  DODGE / 3 SKILL (radial cooldown rings) / ULTIMATE (fill + glow when charged) buttons,
  per-pointer multi-touch with slide-off release and stuck-touch safety nets, 150 ms input
  buffer on game time, keyboard and gamepad (standard mapping), browser gesture blocking,
  fullscreen + landscape lock on first tap, portrait hint.
- Rendering: ACES tone mapping, sRGB output, PMREM environment map, moonlight key with a tight
  texel-snapped shadow frustum following the player, hemisphere fill, fresnel rim light on the
  hero, exponential fog, flickering brazier lights, GPU ember/dust particles, blob contact
  shadow, bloom (HIGH), CSS vignette.
- Quality presets LOW/MEDIUM/HIGH (pixel ratio, shadows, shadow map size, bloom, particles,
  point lights, enemy cap, texture budgets) with a startup FPS benchmark (median-based,
  no oscillation) and a device-hint initial guess; result saved and reused.
- Physics: Rapier world, kinematic character controller (slide, slope limit, auto-step,
  snap-to-ground), data-built test arena (wall ring, pillars, steps, ramp + platform, rocks,
  braziers) with instanced visuals.
- Placeholder hero Kael: capsule-based body with procedural breathing, distance-driven run
  cycle, lean, and an alternating placeholder blade swing on ATTACK.
- Follow camera: distance/height/yaw/FOV in config, smoothing, look-ahead, trauma shake.
- Save: versioned JSON with migration runner, IndexedDB → localStorage → memory backends,
  corrupt/future saves backed up instead of destroyed. Settings persisted.
- Debug: overlay (FPS, frame time mean/p95/max, logic steps, draw calls, triangles,
  geometries/textures/programs, entities, particles, colliders, JS heap, quality, DPR,
  player state, input state) toggled by triple-tapping the top-left corner; cheats (shake,
  hit-stop, slow-mo, fill ultimate, reset cooldowns, flash); log capture; "Copy debug log" in
  the pause menu and on the fatal error screen.
- Title screen shown instantly while the engine chunk loads; pause menu with graphics,
  FPS cap, debug overlay, fullscreen, respawn and copy-log.
