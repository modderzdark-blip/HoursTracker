// MAP: the level map, virtualized for 20,000+ levels.
// Like the original's map today: a candy road winding up through a painted land on a round, turning world. The land
// near you is big and flat; further up it curves away over a horizon into the sky, so scrolling rolls the world toward
// you and the next levels rise over the hill. Level 1 is at the bottom; each episode of 15 levels has its own land
// (meadow, lollipop forest, snowy peaks ...) with clouds and a ribbon banner where it begins. Trees, houses and the
// round level buttons stand upright on the curve and shrink as they roll away.
// Rendering: each episode's land (its ground, the road, the doors to the next episodes) is painted once, with its own
// set pieces and props from a per-family atlas (mapart.js). With WebGL (mapgl.js) the lands are painted by a worker
// (mapworker.js), go up to the GPU a slice per frame, and every frame is a few textured draws at the screen's full
// resolution: the land as a mesh bent along the curve, the sky, then the standing things. Without WebGL a 2D canvas
// draws the same world in thin strips. The level buttons (a recycled pool of at most 60) live in a layer that stays
// put while the page scrolls and are placed on the same curve, so taps and swipes work as on any scrolling page.
(function attachMap(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const LEVELS = SC.LEVELS;
  const SCENERY = SC.SCENERY;
  const SPRITES = SC.SPRITES;
  const MAPART = SC.MAPART;
  const MAPGL = SC.MAPGL;
  const STORAGE = SC.STORAGE;
  const UTIL = SC.UTIL;

  const NODE_SPACING = 86;
  const EPISODE_GAP = 230;
  const TOP_PADDING = 260;
  const BOTTOM_PADDING = 250;
  const OVERSCAN_PX = 160;
  const MAX_LIVE_NODES = 60;
  const SCENERY_CACHE = 3;
  const SPRITE_CACHE = 3;
  const ROW_STEP = 3; // map px per row of the curved land mesh (WebGL)
  const CARD_BELOW_DOOR = 128; // an episode's banner, this far below the seam (under the door between the lands)
  // The road: a wide band of land winding up the map (a share of the road width either side of its middle), with the
  // level buttons zigzagging a little inside it, like the original's map today.
  const BAND = { half: 0.22, wobble: 0.055 };
  // The world's shape, in screen heights: the land is flat and full size at `anchor` (from the top of the screen); above
  // it the ground turns away over a drum of `radius`, seen from `camera` away, and things shrink with distance (`shrink`
  // makes far things smaller than true perspective, for a rounder look). Below the anchor it curves gently (`below`
  // times the radius). The horizon is an arc `arc` screen widths in radius, so the world reads as a ball. Buttons shrink
  // faster than the land (`button_shrink`), so the levels further up the hill never pile onto each other.
  const WORLD = { anchor: 0.63, radius: 0.85, camera: 0.75, below: 2.5, shrink: 1.8, arc: 1.2, button_shrink: 1.7 };
  const SKY = {
    day: { top: '#56b4ff', middle: '#9bd6ff', horizon: '#e4f6ff' },
    night: { top: '#120b38', middle: '#2c1d6e', horizon: '#7b5ec9' },
  };
  const TRANSFORM_PROPS = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('translate', '1px 1px') && CSS.supports('scale', '1');
  const Z_BASE = 200000;

  function rgbOf(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgbaOf(hex, alpha) {
    const rgb = rgbOf(hex);
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }

  /** Where s (map pixels above the anchor) lands on the screen of world w: { y, k } (k = scale there). */
  function projectWith(w, s) {
    const radius = s >= 0 ? w.radius : w.radius_below;
    const turn = s / radius;
    const depth = radius * (1 - Math.cos(turn));
    const perspective = w.camera / (w.camera + depth);
    return { y: w.anchor - radius * Math.sin(turn) * perspective, k: s > 0 ? Math.pow(perspective, WORLD.shrink) : perspective };
  }

  /** The curve for one screen size, with the strips the land is drawn in (each thin enough to look smooth). */
  function buildWorld(view_w, view_h) {
    const w = { view_w, view_h, anchor: Math.round(view_h * WORLD.anchor), radius: view_h * WORLD.radius, camera: view_h * WORLD.camera, sky: {} };
    w.radius_below = w.radius * WORLD.below;
    // The land ends where it has turned so far that a map pixel would show as a sliver: the horizon.
    let s_cut = 0;
    let previous = projectWith(w, 0).y;
    for (let s = 1; s < view_h * 3; s += 1) {
      const y = projectWith(w, s).y;
      if (previous - y < 0.15) break;
      previous = y;
      s_cut = s;
    }
    let s_min = 0;
    while (projectWith(w, s_min).y < view_h + 1 && s_min > -view_h * 2) s_min -= 1;
    const edge = projectWith(w, s_cut);
    w.s_cut = s_cut;
    w.s_min = s_min;
    w.horizon_y = edge.y;
    w.fade = s_cut * 0.3;
    w.arc_r = view_w * WORLD.arc;
    w.arc_cy = w.horizon_y + w.arc_r;
    w.arc_drop = w.arc_r - Math.sqrt(Math.max(0, w.arc_r * w.arc_r - (view_w / 2) * (view_w / 2)));
    w.haze = view_h * 0.17;
    // The sky overlay reaches down past the horizon's lowest point far enough to hold the haze below it.
    w.sky_h = Math.ceil(w.horizon_y + w.arc_drop + w.haze + 4);
    // Wide enough that the land still fills the screen where it is smallest, at the horizon.
    w.land_w = Math.ceil(view_w / edge.k) + 24;
    const table = [];
    for (let s = s_min; s <= s_cut; s += 1) table.push(projectWith(w, s));
    w.strips = [];
    let low = 0;
    while (low < table.length - 1) {
      let high = low + 1;
      while (high < table.length - 1) {
        const next = high + 1;
        if (table[low].y - table[next].y > 28 || Math.abs(table[low].k - table[next].k) > 0.0035) break;
        const middle = (low + next) >> 1;
        const straight = table[low].y + (table[next].y - table[low].y) * ((middle - low) / (next - low));
        if (Math.abs(straight - table[middle].y) > 0.5) break;
        high = next;
      }
      w.strips.push({ s_low: s_min + low, s_high: s_min + high, y_bottom: table[low].y, y_top: table[high].y, k: (table[low].k + table[high].k) / 2 });
      low = high;
    }
    // For WebGL: the rows of the land's mesh, every ROW_STEP map px from the bottom of the screen to the horizon.
    w.rows = [];
    for (let s = s_min; s < s_cut; s += ROW_STEP) w.rows.push(Object.assign({ s }, table[s - s_min]));
    w.rows.push(Object.assign({ s: s_cut }, table[s_cut - s_min]));
    return w;
  }

  function createMap(dom, hooks) {
    const EPISODE = LEVELS.EPISODE_SIZE;
    let save = null;
    let last_level = 1; // the highest node drawn (the end cap sits after it)
    let width = 360; // the road's width (content x runs 0..width, centered on the screen)
    let total_height = 1000;
    let world = null;
    let rendered = { first: 0, last: -1 };
    let marker_level = 1;
    let marker_state = { x: 0, y: 0, lift: 0, grow: 1 };
    let marker_override = null;
    let scroll_frame = 0;
    let prefetch_timer = 0;
    // Detail: on a phone too slow to scroll the curved world smoothly, the map canvas drops to one pixel per CSS pixel.
    let light = false;
    let land_budget = 1; // lands a frame may still paint (see landNow)
    let land_waiting = false;
    let slow_ms = 0;
    let last_frame = 0;
    let generation = 0;
    let glide = 0; // the running scroll glide (a new jump cancels it)
    let lands_painted = 0; // how many times a land was painted (tests: scrolling should not repaint lands)
    let fresh_view = true; // the map just opened or jumped: paint the land in view at once (not via the worker)
    const node_pool = [];
    const live_nodes = new Map(); // level -> button
    const episode_cards = new Map(); // episode -> element
    const scenery_cache = new Map(); // episode -> { canvas, standing, sprites, ... } (LRU)
    const sprite_cache = new Map(); // land family -> atlas of its set pieces and props (LRU; kept while a land uses it)
    // The painter worker (WebGL only; see "the painter worker" below).
    const UPLOAD_BYTES = 4 * 1024 * 1024; // pixels sent to the GPU per frame
    const MAX_JOBS = 2;
    const uploads = []; // lands and atlases whose pixels are still going up
    const land_jobs = new Map(); // episode -> { serial, plan }
    const atlas_jobs = new Set(); // atlas keys
    let world_serial = 0; // a new layout makes the jobs from before it stale
    let painter = null;
    const bursts = new Set();
    let end_cap = null;
    let marker = null;
    // With WebGL the world is drawn from textures in a few draw calls at the screen's full sharpness; without it, the
    // 2D canvas draws it (lighter). (Tests set SC_MAP_2D to check the 2D drawing.)
    const gl = MAPGL && !root.SC_MAP_2D ? MAPGL.create(dom.map_canvas) : null;
    const batch = gl ? MAPGL.createBatch(4096) : null;

    // ---------------------------------------------------------------- geometry (pure functions of the level number)
    function blockHeight() {
      return EPISODE * NODE_SPACING + EPISODE_GAP;
    }

    /** Distance of level n's node above the bottom of the map. */
    function heightOf(level_number) {
      const episode_index = Math.floor((level_number - 1) / EPISODE);
      const in_episode = (level_number - 1) % EPISODE;
      return BOTTOM_PADDING + episode_index * blockHeight() + EPISODE_GAP * 0.5 + in_episode * NODE_SPACING;
    }

    /**
     * A continuous level coordinate for a height above the bottom of the map: level n sits at n, and the gap between two
     * episodes runs smoothly from the last level of one to the first of the next (below level 1 it keeps counting down).
     */
    function levelCoord(height_above_bottom) {
      const offset = height_above_bottom - BOTTOM_PADDING - EPISODE_GAP * 0.5;
      if (offset < 0) return 1 + offset / NODE_SPACING;
      const block = blockHeight();
      const episode_index = Math.floor(offset / block);
      const inside = offset - episode_index * block;
      const span = (EPISODE - 1) * NODE_SPACING;
      if (inside <= span) return episode_index * EPISODE + inside / NODE_SPACING + 1;
      return episode_index * EPISODE + EPISODE + (inside - span) / (block - span);
    }

    /** The middle of the road at level coordinate u: long, gentle bends. */
    function bandX(u) {
      return width / 2 + (Math.sin(u * 0.3 + 0.5) * 0.12 + Math.sin(u * 0.11 + 2.1) * 0.05) * width;
    }

    function bandHalf(u) {
      return width * BAND.half * (1 + 0.05 * Math.sin(u * 0.47 + 1.3));
    }

    /** Each level sits on the road, a little left or right of its middle. */
    function pointOf(level_number) {
      return { x: bandX(level_number) + Math.sin(level_number * 1.7 + 0.3) * BAND.wobble * width, y: total_height - heightOf(level_number) };
    }

    /** Levels whose nodes fall inside [top, bottom] in map coordinates. */
    function levelsInRange(top, bottom) {
      const high = Math.ceil(levelAtHeight(total_height - top)) + 1;
      const low = Math.floor(levelAtHeight(total_height - bottom)) - 1;
      return { first: Math.max(1, low), last: Math.min(last_level + 1, high) };
    }

    function levelAtHeight(height_above_bottom) {
      const offset = height_above_bottom - BOTTOM_PADDING - EPISODE_GAP * 0.5;
      const episode_index = Math.floor(offset / blockHeight());
      const inside = (offset - episode_index * blockHeight()) / NODE_SPACING;
      return episode_index * EPISODE + Math.min(EPISODE - 1, Math.max(0, inside)) + 1;
    }

    function scrollTopFor(level_number) {
      return Math.max(0, Math.min(total_height - dom.map_scroll.clientHeight, pointOf(level_number).y - dom.map_scroll.clientHeight * 0.58));
    }

    function mapBottom() {
      return total_height - BOTTOM_PADDING;
    }

    /** The episode whose land holds map height y (0 or less: the land below level 1). */
    function episodeAtY(y) {
      return Math.floor((mapBottom() - y) / blockHeight()) + 1;
    }

    function blockTop(episode) {
      return mapBottom() - episode * blockHeight();
    }

    function project(s) {
      return projectWith(world, s);
    }

    function shipped() {
      return LEVELS.shippedCount();
    }

    function furthest() {
      return save ? Math.max(1, save.unlocked) : 1;
    }

    // ---------------------------------------------------------------- nodes

    function starsOf(level_number) {
      return save ? STORAGE.levelBest(save, level_number).stars : 0;
    }

    function takeNode() {
      const node = node_pool.pop() || document.createElement('button');
      node.type = 'button';
      node.className = 'map-node';
      node.innerHTML = '';
      return node;
    }

    function fillNode(node, level_number) {
      const reached = marker_override !== null ? marker_override : furthest();
      const available = level_number <= shipped();
      const completed = starsOf(level_number) > 0 || level_number < reached;
      const unlocked = level_number <= reached && (available || completed);
      const is_current = level_number === reached && available;
      const role = LEVELS.roleOf(level_number);
      const crowned = unlocked && !is_current && !!(hooks.hasCrown && hooks.hasCrown(level_number));
      node.className = `map-node${unlocked ? '' : ' is-locked'}${is_current ? ' is-current' : ''}${crowned ? ' is-crowned' : ''}${role === 'hard' ? ' is-hard' : role === 'superhard' ? ' is-superhard' : ''}`;
      node.dataset.levelId = String(level_number);
      const point = pointOf(level_number);
      node.map_x = point.x;
      node.map_y = point.y;
      // Nearer levels (lower numbers) stand in front of the ones further up the hill.
      node.style.zIndex = String(2 * (Z_BASE - level_number));
      const stars = starsOf(level_number);
      const digits = String(level_number).length;
      // Like the original, levels ahead show their numbers too (in a pale, unlit button).
      let html = `<span class="node-number digits-${Math.min(5, digits)}">${level_number}</span>`;
      if (unlocked && !is_current) {
        html += '<span class="node-stars">';
        for (let star = 0; star < 3; star += 1) html += hooks.icon(star < stars ? 'star' : 'star_empty');
        html += '</span>';
      }
      if (crowned) html += `<span class="node-crown">${hooks.icon('crown')}</span>`;
      else if (role === 'hard' || role === 'superhard') html += `<span class="node-ribbon">${hooks.icon('skull')}${role === 'hard' ? 'Hard' : 'Super Hard'}</span>`;
      if (crowned && hooks.hasMastery && hooks.hasMastery(level_number)) html += `<span class="node-mastery">${hooks.icon('sparkle')}</span>`;
      if (hooks.hasTreasure && hooks.hasTreasure(level_number)) html += `<span class="node-treasure">${hooks.icon('chest')}</span>`;
      if (is_current) html += `<span class="node-cost">${hooks.icon('heart')}1</span>`;
      node.innerHTML = html;
      node.setAttribute('aria-label', unlocked
        ? `Level ${level_number}${role === 'hard' ? ', hard' : role === 'superhard' ? ', super hard' : ''}, ${stars} of 3 stars${crowned ? ', won on the first try' : ''}${is_current ? ', next to play' : ''}`
        : `Level ${level_number}, locked`);
      node.onclick = () => {
        hooks.sound('tap');
        if (unlocked && available) hooks.select(level_number);
        else if (unlocked) hooks.toast('This level is not in this version yet.');
        else hooks.toast('Finish the previous level to unlock this one!');
      };
    }

    function episodeCard(episode) {
      const card = document.createElement('div');
      card.className = 'map-episode';
      const range = LEVELS.episodeRange(episode);
      card.innerHTML = `<div class="episode-gate" aria-hidden="true"></div><div class="episode-title"><small>Episode ${episode}</small><strong>${LEVELS.episodeName(episode)}</strong><small>Levels ${range.first}-${range.last}</small></div>`;
      // Where this episode's land begins: on the road just before its door (the first episode's has no door, so on the
      // seam itself), between the previous episode's last level and the door.
      card.map_x = width / 2;
      card.map_y = blockTop(episode) + blockHeight() + (episode >= 2 ? CARD_BELOW_DOOR : 0);
      card.style.zIndex = String(2 * (Z_BASE - range.first) + 1);
      return card;
    }

    /** The map rows from the horizon to just below the screen. */
    function visibleSpan() {
      const scroll_top = dom.map_scroll.scrollTop;
      return { top: scroll_top + world.anchor - world.s_cut, bottom: scroll_top + world.anchor - world.s_min };
    }

    /** Creates, recycles and removes nodes so only the ones on (or near) the screen exist. */
    function updateNodes() {
      const span = visibleSpan();
      const top = span.top - OVERSCAN_PX;
      const bottom = span.bottom + OVERSCAN_PX;
      let range = levelsInRange(top, bottom);
      if (range.last - range.first + 1 > MAX_LIVE_NODES) {
        const center = Math.round(levelAtHeight(total_height - (dom.map_scroll.scrollTop + world.anchor)));
        range = { first: Math.max(1, center - MAX_LIVE_NODES / 2 + 1), last: center + MAX_LIVE_NODES / 2 };
      }
      range.last = Math.min(range.last, last_level);
      live_nodes.forEach((node, level_number) => {
        if (level_number < range.first || level_number > range.last) {
          node.remove();
          node.onclick = null;
          live_nodes.delete(level_number);
          node_pool.push(node);
        }
      });
      for (let level_number = range.first; level_number <= range.last; level_number += 1) {
        if (live_nodes.has(level_number)) continue;
        const node = takeNode();
        fillNode(node, level_number);
        live_nodes.set(level_number, node);
        dom.map_nodes.appendChild(node);
      }
      // A banner for each episode seam on the screen (up to the last shipped episode).
      const block = blockHeight();
      const first_episode = Math.max(1, episodeAtY(bottom));
      const last_episode = Math.min(LEVELS.episodeOf(Math.max(1, last_level)), episodeAtY(top));
      const seamVisible = (episode) => {
        const at = blockTop(episode) + block + (episode >= 2 ? CARD_BELOW_DOOR : 0);
        return at >= top && at <= bottom;
      };
      episode_cards.forEach((card, episode) => {
        if (episode < first_episode || episode > last_episode || !seamVisible(episode)) {
          card.remove();
          episode_cards.delete(episode);
        }
      });
      for (let episode = first_episode; episode <= last_episode; episode += 1) {
        if (episode_cards.has(episode) || !seamVisible(episode)) continue;
        const card = episodeCard(episode);
        episode_cards.set(episode, card);
        dom.map_nodes.appendChild(card);
      }
      rendered = range;
    }

    // ---------------------------------------------------------------- the land (only the visible episodes)

    /** Episode 0 and below is the land under level 1: the first episode's family with its own layout, no road. */
    function landScenery(episode) {
      if (episode >= 1) return LEVELS.sceneryOf(episode);
      const first = LEVELS.sceneryOf(1);
      return Object.assign({}, first, { seed: (first.seed || 1) + 7777 });
    }

    /** A canvas's pixels are given back once the GPU has its copy (WebGL keeps only the texture). */
    function freeCanvas(canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }

    function atlasKey(scenery) {
      return `${scenery.family}|${scenery.hue_shift || 0}`;
    }

    /** The atlas is about 900 x 1100 map px; with WebGL it stays a mipmapped texture, so it can be sharp. */
    function atlasRatio() {
      const dpr = root.devicePixelRatio || 1;
      return gl ? Math.min(2.5, Math.max(1.5, dpr), gl.max_texture / 1200) : Math.min(1.5, dpr);
    }

    /** One land family's set pieces and props, each painted once into an atlas (and uploaded, with WebGL). */
    function atlasFor(scenery) {
      const key = atlasKey(scenery);
      if (sprite_cache.has(key)) return sprite_cache.get(key);
      const atlas = MAPART.buildAtlas(scenery.family, SCENERY.landFor(scenery), atlasRatio(), SPRITES.createCanvas);
      atlas.width = atlas.canvas.width;
      atlas.height = atlas.canvas.height;
      if (gl) {
        atlas.texture = gl.upload(atlas.canvas, true, atlas);
        if (atlas.texture) freeCanvas(atlas.canvas);
      }
      sprite_cache.set(key, atlas);
      return atlas;
    }

    /** Stops sending a texture's rows to the GPU and lets the texture go. */
    function releaseTexture(owner) {
      const queued = uploads.indexOf(owner);
      if (queued >= 0) uploads.splice(queued, 1);
      if (gl) gl.release(owner);
    }

    /** Forgets the oldest atlases beyond the cache's size that no cached (or coming) land stands on. */
    function pruneAtlases() {
      Array.from(sprite_cache.entries()).forEach(([key, atlas]) => {
        if (sprite_cache.size <= SPRITE_CACHE) return;
        if (Array.from(scenery_cache.values()).some((entry) => entry.atlas_key === key)) return;
        if (Array.from(land_jobs.values()).some((job) => atlasKey(job.plan.scenery) === key)) return;
        releaseTexture(atlas);
        sprite_cache.delete(key);
      });
    }

    /** The door between episode e - 1 and e (a cliff with stairs, a river, a bridge or a gate), in turn. */
    function doorKind(episode) {
      return MAPART.DOORS[(episode - 2) % MAPART.DOORS.length];
    }

    function dropLand(key) {
      const entry = scenery_cache.get(key);
      if (entry) releaseTexture(entry);
      scenery_cache.delete(key);
    }

    function dropLands() {
      Array.from(scenery_cache.keys()).forEach(dropLand);
    }

    function storeLand(key, entry) {
      scenery_cache.set(key, entry);
      while (scenery_cache.size > SCENERY_CACHE) dropLand(scenery_cache.keys().next().value);
      pruneAtlases();
    }

    /**
     * What one episode's land needs to be painted (flat, wider than the screen): its size and sharpness, its road, the
     * doors to the neighbouring episodes and the options for MAPART.paintEpisode.
     */
    function landPlan(key) {
      const block = blockHeight();
      const land_w = world.land_w;
      // With WebGL the land is kept only as a mipmapped texture, so it can be sharp (up to about 6 million pixels; a
      // tablet's wider land gets a little less); the 2D canvas keeps it lighter.
      const dpr = root.devicePixelRatio || 1;
      const ratio = gl
        ? Math.min(2, Math.max(1.25, dpr), gl.max_texture / land_w, gl.max_texture / block, Math.sqrt(6e6 / (land_w * block)))
        : Math.min(1.25, dpr, 1100 / land_w);
      const scenery = landScenery(key);
      const land = SCENERY.landFor(scenery);
      const top = blockTop(key);
      const shift_x = (land_w - width) / 2;
      const road = (cy) => {
        const u = levelCoord(total_height - (top + cy));
        return { x: bandX(u) + shift_x, half: bandHalf(u) };
      };
      // Props sized for the screen (the land is wider than the screen, but the trees should not grow with it).
      const unit = Math.max(24, Math.min(40, world.view_w * 0.075));
      const doors = { bottom: key >= 2 ? doorKind(key) : null, top: key >= 1 ? doorKind(key + 1) : null };
      return {
        ratio, scenery, land, shift_x, road,
        px_w: Math.max(1, Math.round(land_w * ratio)),
        px_h: Math.max(1, Math.round(block * ratio)),
        options: {
          width: land_w, height: block, land, family: scenery.family, episode: key, unit, doors,
          lower: key >= 1 ? SCENERY.landFor(landScenery(key - 1)) : land, upper: SCENERY.landFor(landScenery(key + 1)),
        },
      };
    }

    /** Paints one episode's land here and now (and its atlas if needed): the 2D map, and WebGL without the worker. */
    function sceneryFor(episode) {
      const key = Math.max(0, episode);
      if (scenery_cache.has(key)) {
        if (scenery_cache.get(key).ready !== false) return touchLand(key);
        dropLand(key); // still on its way to the GPU: paint it here instead
      }
      lands_painted += 1;
      const plan = landPlan(key);
      const canvas = SPRITES.createCanvas(plan.px_w, plan.px_h);
      // Painted on the CPU (willReadFrequently keeps it off the GPU): hundreds of paths reach the GPU as one picture.
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.scale(plan.ratio, plan.ratio);
      const standing = MAPART.paintEpisode(ctx, Object.assign({ road: plan.road }, plan.options));
      atlasFor(plan.scenery);
      const entry = { canvas, ratio: plan.ratio, standing, shift_x: plan.shift_x, scenery: plan.scenery, atlas_key: atlasKey(plan.scenery), land: plan.land, px_w: plan.px_w, px_h: plan.px_h };
      if (gl) {
        entry.texture = gl.upload(canvas, true, entry);
        if (entry.texture) freeCanvas(canvas);
      }
      storeLand(key, entry);
      return entry;
    }

    function touchLand(key) {
      const entry = scenery_cache.get(key);
      scenery_cache.delete(key);
      scenery_cache.set(key, entry);
      return entry;
    }

    // ---------------------------------------------------------------- the painter worker (WebGL)
    // Lands and atlases are painted by js/mapworker.js and come back as pixels, which go up to the GPU a slice per
    // frame, so a new episode never stalls scrolling. Where workers or OffscreenCanvas are missing (or fail), the lands
    // are painted on this thread instead.
    function stopPainter() {
      if (painter) painter.terminate();
      painter = null;
      land_jobs.clear();
      atlas_jobs.clear();
      onScroll();
    }

    /** The episodes worth keeping a land for: the visible ones and one either side. */
    function landWanted(key) {
      const span = visibleSpan();
      return key >= Math.max(0, episodeAtY(span.bottom)) - 1 && key <= episodeAtY(span.top) + 1;
    }

    function onPainted(event) {
      const done = event.data;
      if (done.type === 'failed') {
        stopPainter();
        return;
      }
      if (done.type === 'atlas') {
        atlas_jobs.delete(done.id);
        if (!gl || sprite_cache.has(done.id)) return;
        const atlas = { cells: done.cells, anchor_x: done.anchor_x, anchor_y: done.anchor_y, width: done.width, height: done.height, pixels: done.pixels, row: 0, ready: false };
        atlas.texture = gl.allocate(atlas, done.width, done.height);
        if (!atlas.texture) return;
        sprite_cache.set(done.id, atlas);
        uploads.push(atlas);
        pruneAtlases();
        onScroll();
        return;
      }
      const job = land_jobs.get(done.id);
      land_jobs.delete(done.id);
      if (!job || !world || job.serial !== world_serial || scenery_cache.has(done.id)) return;
      if (!landWanted(done.id)) {
        onScroll(); // another land may be waiting for a free job
        return;
      }
      const plan = job.plan;
      const entry = { ratio: plan.ratio, standing: done.standing, shift_x: plan.shift_x, scenery: plan.scenery, atlas_key: atlasKey(plan.scenery), land: plan.land, px_w: plan.px_w, px_h: plan.px_h, pixels: done.pixels, row: 0, ready: false };
      entry.texture = gl.allocate(entry, plan.px_w, plan.px_h);
      if (!entry.texture) return;
      storeLand(done.id, entry);
      uploads.push(entry);
      onScroll();
    }

    // The GPU's copies are gone when the phone reclaims the context: paint everything again once it is back.
    function forgetTextures() {
      scenery_cache.clear();
      sprite_cache.clear();
      uploads.length = 0;
      land_jobs.clear();
      atlas_jobs.clear();
      if (world) world.sky = {};
    }
    if (gl) {
      gl.onLost(forgetTextures);
      gl.onRestored(() => {
        forgetTextures();
        redraw();
      });
    }

    if (gl && typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && !root.SC_MAP_SYNC) {
      try {
        painter = new Worker('js/mapworker.js');
        painter.onmessage = onPainted;
        painter.onerror = stopPainter;
      } catch (worker_error) {
        painter = null;
      }
    }

    function requestAtlas(scenery) {
      const key = atlasKey(scenery);
      if (sprite_cache.has(key) || atlas_jobs.has(key)) return;
      atlas_jobs.add(key);
      painter.postMessage({ type: 'atlas', id: key, family: scenery.family, land: SCENERY.landFor(scenery), ratio: atlasRatio() });
    }

    /** Asks the worker for a land (unless it is already busy with enough). */
    function requestLand(key) {
      if (land_jobs.has(key) || land_jobs.size >= MAX_JOBS) return;
      lands_painted += 1;
      const plan = landPlan(key);
      // The road, sampled every 2 map px (the worker draws it from these).
      const from = -200;
      const step = 2;
      const count = Math.ceil((plan.options.height - from * 2) / step) + 1;
      const road = new Float32Array(count * 2);
      for (let index = 0; index < count; index += 1) {
        const at = plan.road(from + index * step);
        road[index * 2] = at.x;
        road[index * 2 + 1] = at.half;
      }
      requestAtlas(plan.scenery);
      land_jobs.set(key, { serial: world_serial, plan });
      painter.postMessage({ type: 'land', id: key, ratio: plan.ratio, px_w: plan.px_w, px_h: plan.px_h, road, road_from: from, road_step: step, options: plan.options }, [road.buffer]);
    }

    /** Sends the next slice of waiting pixels up to the GPU; a finished texture gets its mipmaps and is ready. */
    function pumpUploads() {
      let budget = UPLOAD_BYTES;
      while (uploads.length && budget > 0) {
        const item = uploads[0];
        const width = item.texture.width;
        const height = item.texture.height;
        const rows = Math.min(height - item.row, Math.max(8, Math.floor(budget / (width * 4))));
        gl.uploadRows(item.texture, item.pixels, item.row, rows);
        item.row += rows;
        budget -= rows * width * 4;
        if (item.row >= height) {
          gl.finish(item.texture, true);
          item.pixels = null;
          item.ready = true;
          uploads.shift();
        }
      }
      if (uploads.length) land_waiting = true;
    }

    /** How much of a night land is at map height y (0..1), blending across the seams. */
    function nightAt(y) {
      const position = (mapBottom() - y) / blockHeight();
      const episode = Math.floor(position) + 1;
      const inside = position - Math.floor(position);
      const nightOf = (index) => (SCENERY.landFor(landScenery(index)).night ? 1 : 0);
      const here = nightOf(episode);
      if (inside > 0.85) return here + (nightOf(episode + 1) - here) * ((inside - 0.85) / 0.15) * 0.5;
      if (inside < 0.15) return here + (nightOf(episode - 1) - here) * ((0.15 - inside) / 0.15) * 0.5;
      return here;
    }

    /**
     * The sky, drawn over the land as one overlay: a soft gradient, high clouds and a bank of clouds resting on the hill
     * (or stars and the moon), cut off along the curved horizon, with the haze that mists the far land just below it.
     */
    function skyFor(night) {
      const key = night ? 'night' : 'day';
      if (world.sky[key]) return world.sky[key];
      const view_w = world.view_w;
      const height = world.sky_h;
      const ratio = gl ? Math.min(2.5, root.devicePixelRatio || 1) : Math.min(1.5, root.devicePixelRatio || 1);
      const canvas = SPRITES.createCanvas(Math.max(1, Math.round(view_w * ratio)), Math.max(1, Math.round(height * ratio)));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.scale(ratio, ratio);
      const colors = night ? SKY.night : SKY.day;
      const fill = ctx.createLinearGradient(0, 0, 0, height);
      fill.addColorStop(0, colors.top);
      fill.addColorStop(UTIL.clamp((world.horizon_y * 0.55) / height, 0.05, 0.9), colors.middle);
      fill.addColorStop(UTIL.clamp((world.horizon_y + world.arc_drop * 0.5) / height, 0.1, 1), colors.horizon);
      fill.addColorStop(1, colors.horizon);
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, view_w, height);
      const rng = UTIL.createRng(night ? 41 : 17);
      if (night) {
        ctx.fillStyle = '#ffffff';
        for (let star = 0; star < 60; star += 1) {
          ctx.globalAlpha = 0.35 + rng() * 0.6;
          ctx.beginPath();
          ctx.arc(rng() * view_w, rng() * world.horizon_y, rng() < 0.85 ? 0.9 : 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        const moon_x = view_w * 0.78;
        const moon_y = world.horizon_y * 0.5;
        const glow = ctx.createRadialGradient(moon_x, moon_y, 4, moon_x, moon_y, 42);
        glow.addColorStop(0, 'rgba(255,246,200,0.55)');
        glow.addColorStop(1, 'rgba(255,246,200,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(moon_x - 42, moon_y - 42, 84, 84);
        ctx.fillStyle = '#fff6cf';
        ctx.beginPath();
        ctx.arc(moon_x, moon_y, 13, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const sun_x = view_w * 0.82;
        const sun_y = world.horizon_y * 0.42;
        const glow = ctx.createRadialGradient(sun_x, sun_y, 6, sun_x, sun_y, 70);
        glow.addColorStop(0, 'rgba(255,255,236,0.9)');
        glow.addColorStop(1, 'rgba(255,255,236,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(sun_x - 70, sun_y - 70, 140, 140);
      }
      for (let cloud = 0; cloud < 3; cloud += 1) {
        const cloud_x = view_w * (0.12 + cloud * 0.36 + (rng() - 0.5) * 0.08);
        const cloud_y = world.horizon_y * (0.3 + rng() * 0.3);
        const puff = 9 + rng() * 6;
        ctx.globalAlpha = night ? 0.3 : 0.9;
        for (let part = 0; part < 4; part += 1) SCENERY.paintPuff(ctx, cloud_x + (part - 1.5) * puff * 0.95, cloud_y + (part % 2 ? -puff * 0.35 : puff * 0.1), puff * (part % 2 ? 1 : 0.78), night);
      }
      // A bank of clouds resting on the horizon: the land hides their lower halves, so the hill rolls in front of them.
      ctx.globalAlpha = night ? 0.45 : 0.95;
      for (let x = -24; x < view_w + 36;) {
        const ground = world.arc_cy - Math.sqrt(Math.max(0, world.arc_r * world.arc_r - (x - view_w / 2) * (x - view_w / 2)));
        SCENERY.paintPuff(ctx, x, ground + 2 + rng() * 6, 15 + rng() * 13, night);
        x += 24 + rng() * 12;
      }
      ctx.globalAlpha = 1;
      // Below the horizon the land shows through: cut the sky away there, then lay the haze in the hole.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(view_w / 2, world.arc_cy, world.arc_r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-over';
      const haze = ctx.createRadialGradient(view_w / 2, world.arc_cy, world.arc_r - world.haze, view_w / 2, world.arc_cy, world.arc_r);
      haze.addColorStop(0, rgbaOf(colors.horizon, 0));
      haze.addColorStop(0.65, rgbaOf(colors.horizon, 0.22));
      haze.addColorStop(1, rgbaOf(colors.horizon, 0.92));
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, view_w, height);
      ctx.globalCompositeOperation = 'source-over';
      const sky = { canvas, texture: null };
      if (gl) {
        sky.texture = gl.upload(canvas, false);
        if (sky.texture) freeCanvas(canvas);
      }
      world.sky[key] = sky;
      return sky;
    }

    /**
     * An episode's land for this frame. Painting a land is the costly part of the map, so a frame paints at most one
     * (the nearest first); a land still waiting shows its plain ground colour and is painted on the next frames. On a
     * slow phone this keeps opening or flinging the map from one long stall that holds up taps.
     */
    function landNow(episode, at_once) {
      const key = Math.max(0, episode);
      if (scenery_cache.has(key) && !(at_once && scenery_cache.get(key).ready === false)) {
        const entry = touchLand(key);
        return entry.ready === false ? null : entry;
      }
      // With the worker, a land is asked for and shows its plain ground until it arrives (except the one in view when
      // the map opens or jumps, painted here so the map never shows bare land).
      if (painter && !at_once) {
        requestLand(key);
        return null;
      }
      if (land_budget > 0) {
        land_budget -= 1;
        return sceneryFor(key);
      }
      land_waiting = true;
      return null;
    }

    /** One strip of the land, from the cached episode canvases onto its place on the curve (2D canvas). */
    function paintStrip(ctx, strip, scroll_top) {
      const top = scroll_top + world.anchor - strip.s_high;
      const bottom = scroll_top + world.anchor - strip.s_low;
      const span = bottom - top;
      const block = blockHeight();
      const half = Math.min(world.land_w / 2, world.view_w / (2 * strip.k));
      let y = top;
      for (let part = 0; part < 4 && y < bottom - 0.001; part += 1) {
        const episode = Math.max(0, episodeAtY(y + 0.001));
        const block_top = blockTop(episode);
        const part_bottom = Math.min(bottom, block_top + block);
        const entry = landNow(episode);
        const y0 = strip.y_top + (strip.y_bottom - strip.y_top) * ((y - top) / span);
        const y1 = strip.y_top + (strip.y_bottom - strip.y_top) * ((part_bottom - top) / span);
        if (!entry) {
          ctx.fillStyle = SCENERY.landFor(landScenery(episode)).ground;
          ctx.fillRect(world.view_w / 2 - half * strip.k, y0, half * 2 * strip.k, y1 - y0 + 0.6);
          y = part_bottom;
          continue;
        }
        const ratio = entry.ratio;
        const source_y = Math.max(0, (y - block_top) * ratio);
        const source_h = Math.max(0.5, Math.min(entry.canvas.height - source_y, (part_bottom - y) * ratio));
        ctx.drawImage(entry.canvas, (world.land_w / 2 - half) * ratio, source_y, half * 2 * ratio, source_h, world.view_w / 2 - half * strip.k, y0, half * 2 * strip.k, y1 - y0 + 0.6);
        y = part_bottom;
      }
    }

    /** The first item at or below map row y (items are sorted by y). */
    function firstFrom(items, y) {
      let low = 0;
      let high = items.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (items[middle].y < y) low = middle + 1;
        else high = middle;
      }
      return low;
    }

    // How far below the screen a standing thing's foot may be and still reach up into view (the tallest set piece).
    const STANDING_REACH = 360;

    /**
     * Each set piece and prop stood upright on the curve, far ones first: calls draw(atlas, cell, x, y, w, h, alpha)
     * with its screen rectangle, and episodeDone(atlas) after each episode's (they share one atlas). Things rise out of
     * the haze as they come over the hill, and those still behind the curved horizon are not drawn.
     */
    function eachStanding(scroll_top, draw, episodeDone) {
      const view_w = world.view_w;
      const span = visibleSpan();
      const bottom = span.bottom + STANDING_REACH;
      const far = Math.max(0, episodeAtY(span.top));
      const near = Math.max(0, episodeAtY(bottom));
      for (let episode = far; episode >= near; episode -= 1) {
        const entry = landNow(episode);
        if (!entry) continue;
        let atlas = sprite_cache.get(entry.atlas_key);
        if (!atlas) {
          // Let go while this land was on its way: ask for it again.
          if (painter) requestAtlas(entry.scenery);
          else atlas = atlasFor(entry.scenery);
        }
        if (!atlas || atlas.ready === false) continue;
        const block_top = blockTop(episode);
        const items = entry.standing;
        for (let index = firstFrom(items, span.top - block_top - 40); index < items.length; index += 1) {
          const item = items[index];
          const y = block_top + item.y;
          if (y > bottom) break;
          const s = world.anchor - (y - scroll_top);
          if (s > world.s_cut) continue;
          const cell = atlas.cells[item.kind];
          if (!cell) continue;
          const point = project(s);
          const x = view_w / 2 + (item.x - entry.shift_x - width / 2) * point.k;
          const scale = (item.size / cell.size) * point.k;
          const w = cell.w * scale;
          const h = cell.h * scale;
          const x0 = x - w * atlas.anchor_x;
          if (x0 > view_w || x0 + w < 0) continue;
          const dx = x - view_w / 2;
          const horizon = world.arc_cy - Math.sqrt(Math.max(0, world.arc_r * world.arc_r - dx * dx));
          const alpha = UTIL.clamp((world.s_cut - s) / world.fade, 0, 1) * UTIL.clamp(1 + (point.y - horizon) / 10, 0, 1);
          if (alpha < 0.02) continue;
          draw(atlas, cell, x0, point.y - h * atlas.anchor_y, w, h, alpha);
        }
        if (episodeDone) episodeDone(atlas);
      }
    }

    /** The map canvas's size on the page (its pixels are set by the drawer). */
    function sizeCanvas(canvas, view_w, view_h) {
      const css_w = `${view_w}px`;
      const css_h = `${view_h}px`;
      if (canvas.style.width !== css_w) canvas.style.width = css_w;
      if (canvas.style.height !== css_h) canvas.style.height = css_h;
    }

    /** Draws the land wrapped around the world, then the sky over it (cut along the curved horizon, misted below it). */
    function paintWorld() {
      if (!world) return;
      if (gl) {
        paintWorldGl();
        return;
      }
      const canvas = dom.map_canvas;
      const view_w = world.view_w;
      const view_h = world.view_h;
      const ratio = light ? 1 : Math.min(1.5, root.devicePixelRatio || 1);
      if (canvas.width !== Math.round(view_w * ratio) || canvas.height !== Math.round(view_h * ratio)) {
        canvas.width = Math.round(view_w * ratio);
        canvas.height = Math.round(view_h * ratio);
      }
      sizeCanvas(canvas, view_w, view_h);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const scroll_top = dom.map_scroll.scrollTop;
      land_budget = 1;
      land_waiting = false;
      landNow(episodeAtY(scroll_top + world.anchor)); // the land nearest the eye, which fills most of the screen
      // No clear needed: the strips cover the land from the bottom edge to the horizon and the sky covers the rest.
      world.strips.forEach((strip) => paintStrip(ctx, strip, scroll_top));
      const night = nightAt(scroll_top + world.anchor - world.s_cut * 0.8);
      if (night < 1) ctx.drawImage(skyFor(false).canvas, 0, 0, view_w, world.sky_h);
      if (night > 0) {
        ctx.globalAlpha = night;
        ctx.drawImage(skyFor(true).canvas, 0, 0, view_w, world.sky_h);
      }
      // Standing things over the sky, so the ones near the horizon stand up against it.
      eachStanding(scroll_top, (atlas, cell, x, y, w, h, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.drawImage(atlas.canvas, cell.sx, cell.sy, cell.sw, cell.sh, x, y, w, h);
      });
      ctx.globalAlpha = 1;
      if (land_waiting) onScroll();
      schedulePrefetch();
    }

    /**
     * The same world with WebGL: the land as a mesh of thin rows bent along the curve (each episode's rows in one draw
     * from its texture), the sky, then the standing things as quads from their atlas. Every pixel at the screen's own
     * resolution, and only a handful of draw calls a frame.
     */
    function paintWorldGl() {
      if (gl.lost) return;
      const canvas = dom.map_canvas;
      const view_w = world.view_w;
      const view_h = world.view_h;
      const ratio = light ? Math.min(1.5, root.devicePixelRatio || 1) : Math.min(3, root.devicePixelRatio || 1);
      const scroll_top = dom.map_scroll.scrollTop;
      land_budget = 1;
      land_waiting = false;
      pumpUploads();
      // The land nearest the eye, which fills most of the screen.
      const eye = landNow(episodeAtY(scroll_top + world.anchor), fresh_view);
      fresh_view = false;
      const ground = rgbOf(eye ? eye.land.ground : SCENERY.landFor(landScenery(Math.max(0, episodeAtY(scroll_top + world.anchor)))).ground);
      if (!gl.begin(Math.round(view_w * ratio), Math.round(view_h * ratio), view_w, view_h, [ground[0] / 255, ground[1] / 255, ground[2] / 255])) return;
      sizeCanvas(canvas, view_w, view_h);
      // The land: rows from the bottom of the screen up to the horizon, cut where one episode's land meets the next.
      const rows = world.rows;
      const center = view_w / 2;
      let episode = -1;
      let entry = null;
      const flush = () => {
        if (batch.count) {
          if (entry && entry.texture) gl.draw(entry.texture, batch.data, batch.count, null);
          else {
            const color = rgbOf(SCENERY.landFor(landScenery(episode)).ground);
            gl.draw(null, batch.data, batch.count, [color[0] / 255, color[1] / 255, color[2] / 255, 1]);
          }
        }
        batch.reset();
      };
      const corner = (row_y, row_k, map_y) => {
        const half = Math.min(world.land_w / 2, view_w / (2 * row_k)) + 1;
        if (!entry) return [[center - half * row_k, row_y, 0, 0], [center + half * row_k, row_y, 0, 0]];
        const v = ((map_y - blockTop(episode)) * entry.ratio) / entry.px_h;
        const left = ((world.land_w / 2 - half) * entry.ratio) / entry.px_w;
        const right = ((world.land_w / 2 + half) * entry.ratio) / entry.px_w;
        return [[center - half * row_k, row_y, left, v], [center + half * row_k, row_y, right, v]];
      };
      for (let index = 0; index < rows.length - 1; index += 1) {
        let low = rows[index]; // nearer (lower on the screen)
        const high = rows[index + 1];
        // A row may cross a seam: split it there and finish the lower episode first.
        for (let part = 0; part < 3; part += 1) {
          const low_y = scroll_top + world.anchor - low.s;
          const here = Math.max(0, episodeAtY(low_y - 0.0001));
          if (here !== episode) {
            flush();
            episode = here;
            entry = landNow(episode);
          }
          const seam = blockTop(here); // the top edge of this episode's land
          const high_y = scroll_top + world.anchor - high.s;
          let top = high;
          if (high_y < seam - 0.0001) {
            const t = (low_y - seam) / (low_y - high_y);
            top = { s: low.s + (high.s - low.s) * t, y: low.y + (high.y - low.y) * t, k: low.k + (high.k - low.k) * t };
          }
          const bottom_edge = corner(low.y, low.k, low_y);
          const top_edge = corner(top.y, top.k, scroll_top + world.anchor - top.s);
          batch.quad(top_edge[0], top_edge[1], bottom_edge[1], bottom_edge[0]);
          if (top === high) break;
          low = top;
        }
      }
      flush();
      // The sky, cut along the curved horizon and misting the far land.
      const night = nightAt(scroll_top + world.anchor - world.s_cut * 0.8);
      const skyQuad = (sky, alpha) => {
        if (!sky.texture) return;
        batch.reset();
        batch.rect(0, 0, view_w, world.sky_h, 0, 0, 1, 1);
        gl.draw(sky.texture, batch.data, batch.count, [1, 1, 1, alpha]);
      };
      if (night < 1) skyQuad(skyFor(false), 1);
      if (night > 0) skyQuad(skyFor(true), night);
      batch.reset();
      // The set pieces and props over it (the ones near the horizon stand up against the sky), each episode's from its atlas.
      eachStanding(scroll_top, (atlas, cell, x, y, w, h, alpha) => {
        batch.rect(x, y, w, h, cell.sx / atlas.width, cell.sy / atlas.height, (cell.sx + cell.sw) / atlas.width, (cell.sy + cell.sh) / atlas.height, alpha);
      }, (atlas) => {
        if (batch.count && atlas.texture) gl.draw(atlas.texture, batch.data, batch.count, null);
        batch.reset();
      });
      if (land_waiting) onScroll();
      schedulePrefetch();
    }

    /** While the map rests, paints the next episode up the hill so scrolling into it does not stall. */
    function schedulePrefetch() {
      clearTimeout(prefetch_timer);
      prefetch_timer = setTimeout(() => {
        prefetch_timer = 0;
        if (!world || !dom.screen_map.classList.contains('is-active')) return;
        const span = visibleSpan();
        const ahead = episodeAtY(span.top) + 1;
        const near = Math.max(0, episodeAtY(span.bottom));
        // Only when it fits beside every visible land (never evict one the next frame needs).
        if (scenery_cache.has(ahead) || ahead - near + 1 > SCENERY_CACHE) return;
        if (painter) {
          requestLand(ahead);
          return;
        }
        sceneryFor(ahead);
        // Keep the visible lands the most recently used.
        for (let episode = near; episode <= ahead - 1; episode += 1) if (scenery_cache.has(episode)) touchLand(episode);
      }, painter ? 80 : 220);
    }

    // ---------------------------------------------------------------- the buttons on the curve

    /** Puts one element at map point (x, y) on the curve: moved, scaled, faded near the horizon, hidden past it. */
    function placeItem(element, x, y, scroll_top, grow, lift) {
      const state = element.map_state || (element.map_state = {});
      const s = world.anchor - (y - scroll_top);
      let visible = s <= world.s_cut && s >= world.s_min - 160;
      let opacity = 1;
      let translate = '';
      let scale = '';
      if (visible) {
        const point = project(s);
        opacity = UTIL.clamp((world.s_cut - s) / world.fade, 0, 1);
        if (opacity < 0.04) visible = false;
        translate = `${(world.view_w / 2 + (x - width / 2) * point.k).toFixed(1)}px ${(point.y + (lift || 0) * point.k).toFixed(1)}px`;
        scale = (Math.pow(point.k, WORLD.button_shrink) * (grow || 1)).toFixed(3);
      }
      const shown = visible ? '' : 'hidden';
      if (state.shown !== shown) {
        element.style.visibility = shown;
        state.shown = shown;
      }
      if (!visible) return;
      if (state.translate !== translate || state.scale !== scale) {
        if (TRANSFORM_PROPS) {
          element.style.translate = translate;
          element.style.scale = scale;
        } else {
          const parts = translate.split(' ');
          element.style.left = parts[0];
          element.style.top = parts[1];
        }
        state.translate = translate;
        state.scale = scale;
      }
      const fade = opacity < 1 ? opacity.toFixed(2) : '';
      if (state.fade !== fade) {
        element.style.opacity = fade;
        state.fade = fade;
      }
      // Buttons fading over the hill, or shrunk below a finger's size (about 44 px), cannot be tapped: scroll them closer.
      // The unscaled size is measured once per look (a level's class changes when it is won or unlocked).
      if (state.look !== element.className) {
        state.look = element.className;
        state.base = Math.min(element.offsetWidth, element.offsetHeight) || 44;
      }
      const touch = opacity < 0.6 || state.base * Number(scale) < 44 ? 'none' : '';
      if (state.touch !== touch) {
        element.style.pointerEvents = touch;
        state.touch = touch;
      }
    }

    function positionOverlay() {
      if (!world) return;
      const scroll_top = dom.map_scroll.scrollTop;
      live_nodes.forEach((node) => placeItem(node, node.map_x, node.map_y, scroll_top));
      episode_cards.forEach((card) => placeItem(card, card.map_x, card.map_y, scroll_top));
      if (end_cap && end_cap.parentNode) placeItem(end_cap, end_cap.map_x, end_cap.map_y, scroll_top);
      if (marker && marker.parentNode) placeItem(marker, marker_state.x, marker_state.y, scroll_top, marker_state.grow, marker_state.lift);
      bursts.forEach((burst) => placeItem(burst, burst.map_x, burst.map_y, scroll_top));
    }

    function redraw() {
      if (!world) return;
      updateNodes();
      paintWorld();
      positionOverlay();
    }

    /** Watches the frame pace while scrolling; after 1.5 s of frames slower than about 40 fps, goes light. */
    function pace(time) {
      const interval = time - last_frame;
      last_frame = time;
      if (light || interval <= 0 || interval > 250) return;
      slow_ms = interval > 26 ? slow_ms + interval : Math.max(0, slow_ms - interval);
      if (slow_ms > 1500) light = true;
    }

    function onScroll() {
      if (scroll_frame) return;
      scroll_frame = requestAnimationFrame((time) => {
        scroll_frame = 0;
        pace(time);
        redraw();
      });
    }
    dom.map_scroll.addEventListener('scroll', onScroll, { passive: true });

    // ---------------------------------------------------------------- marker (the player's avatar)

    /** Where the avatar's pin floats: right above its level, pointing down at it, like the original's. */
    function markerPoint(level_number) {
      const point = pointOf(level_number);
      const role = LEVELS.roleOf(level_number);
      return { x: point.x, y: point.y - (role === 'hard' || role === 'superhard' ? 96 : 78) };
    }

    function placeMarker(level_number) {
      if (!marker) {
        marker = document.createElement('div');
        marker.className = 'map-marker';
        marker.setAttribute('aria-hidden', 'true');
        marker.style.zIndex = String(4 * Z_BASE);
      }
      const face = hooks.avatar ? hooks.avatar() : { photo: null, initial: '' };
      const inner = face.photo ? '' : face.initial ? face.initial : `<img src="${hooks.iconUrl('pip', 96)}" alt="">`;
      marker.innerHTML = `<span class="marker-bob"><span class="marker-pin"></span><span class="marker-face"${face.photo ? ` style="background-image:url('${face.photo}')"` : ''}>${inner}</span></span>`;
      const point = markerPoint(level_number);
      marker_state = { x: point.x, y: point.y, lift: 0, grow: 1 };
      if (!marker.parentNode) dom.map_nodes.appendChild(marker);
      marker_level = level_number;
      if (world) placeItem(marker, marker_state.x, marker_state.y, dom.map_scroll.scrollTop, 1, 0);
    }

    function placeEndCap() {
      if (!end_cap) {
        end_cap = document.createElement('button');
        end_cap.type = 'button';
        end_cap.className = 'map-node is-soon';
        end_cap.setAttribute('aria-label', 'More levels coming soon');
        end_cap.innerHTML = '<span>More levels<br>coming soon!</span>';
        end_cap.addEventListener('click', () => {
          hooks.sound('tap');
          hooks.toast('New levels are on the way!');
        });
      }
      const point = pointOf(last_level + 1);
      end_cap.map_x = point.x;
      end_cap.map_y = point.y;
      end_cap.style.zIndex = String(2 * (Z_BASE - last_level - 1));
      if (!end_cap.parentNode) dom.map_nodes.appendChild(end_cap);
    }

    // ---------------------------------------------------------------- public

    function layout() {
      const view_w = dom.map_scroll.clientWidth || 360;
      const view_h = dom.map_scroll.clientHeight || 640;
      width = Math.min(view_w, 760);
      fresh_view = true;
      // The lands and skies are painted for one screen size: let the GPU's copies go with them (and the worker's jobs).
      dropLands();
      world_serial += 1;
      land_jobs.clear();
      if (world && gl) Object.keys(world.sky).forEach((key) => gl.release(world.sky[key].canvas));
      world = buildWorld(view_w, view_h);
      last_level = Math.max(shipped(), save ? save.unlocked - 1 : 1, 1);
      total_height = TOP_PADDING + heightOf(last_level + 1) + BOTTOM_PADDING * 0.2;
      dom.map_inner.style.width = '100%';
      dom.map_inner.style.height = `${total_height}px`;
      if (dom.map_stage) dom.map_stage.style.height = `${view_h}px`;
      live_nodes.forEach((node) => {
        node.remove();
        node_pool.push(node);
      });
      live_nodes.clear();
      episode_cards.forEach((card) => card.remove());
      episode_cards.clear();
      placeEndCap();
    }

    function refreshNodes() {
      live_nodes.forEach((node, level_number) => fillNode(node, level_number));
    }

    function jumpTo(level_number, smooth) {
      const target = scrollTopFor(Math.max(1, Math.min(last_level, level_number)));
      if (!smooth || dom.app.classList.contains('reduced-motion')) {
        glide += 1;
        dom.map_scroll.scrollTop = target;
        fresh_view = true;
        redraw();
        return Promise.resolve(true);
      }
      return animateScroll(target, 650);
    }

    function animateScroll(target, ms) {
      const my_generation = generation;
      glide += 1;
      const my_glide = glide;
      return new Promise((resolve) => {
        const from_top = dom.map_scroll.scrollTop;
        const distance = target - from_top;
        if (Math.abs(distance) < 2) {
          resolve(true);
          return;
        }
        // Long jumps (thousands of levels) cut most of the way, then glide the last screenful.
        const glide_from = Math.abs(distance) > 4000 ? target - Math.sign(distance) * 1200 : from_top;
        dom.map_scroll.scrollTop = glide_from;
        const begin = performance.now();
        const step = (time) => {
          if (my_generation !== generation || my_glide !== glide) return resolve(false);
          const progress = Math.min(1, (time - begin) / ms);
          dom.map_scroll.scrollTop = glide_from + (target - glide_from) * UTIL.EASE.inOutQuad(progress);
          if (progress < 1) requestAnimationFrame(step);
          else resolve(true);
        };
        requestAnimationFrame(step);
      });
    }

    /**
     * Shows the map. options.advance = { from, to }: after a win the map scrolls to the finished level, the marker hops
     * to the next one and it unlocks with a burst. Resolves true when the sequence finished, false if the map was left.
     */
    function render(next_save, options) {
      const opts = options || {};
      save = next_save;
      generation += 1;
      const my_generation = generation;
      layout();
      const reached = furthest();
      const advance = opts.advance && opts.advance.to <= shipped() ? opts.advance : null;
      const hop = !!advance && advance.to === reached && advance.from === advance.to - 1;
      marker_override = hop ? advance.from : null;
      dom.map_scroll.scrollTop = scrollTopFor(advance ? advance.from : Math.min(reached, last_level));
      placeMarker(hop ? advance.from : Math.min(reached, last_level));
      redraw();
      if (!advance) return Promise.resolve(true);
      const reduced = dom.app.classList.contains('reduced-motion');
      const alive = () => my_generation === generation && dom.screen_map.classList.contains('is-active');
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, reduced ? 0 : ms));
      const finished_node = live_nodes.get(advance.from);
      if (finished_node) finished_node.classList.add('just-finished');
      dom.map_scroll.classList.add('is-advancing');
      return (async () => {
        await pause(400);
        if (!alive()) return false;
        await animateScroll(scrollTopFor(advance.to), reduced ? 1 : 650);
        if (!alive()) return false;
        if (hop) {
          const from_point = markerPoint(advance.from);
          const to_point = markerPoint(advance.to);
          const node_point = pointOf(advance.to);
          if (!reduced) {
            hooks.sound('hop');
            // The avatar jumps along the curve: its spot on the map glides while it rises and lands.
            await new Promise((resolve) => {
              const begin = performance.now();
              const step = (time) => {
                if (!alive()) return resolve();
                const t = Math.min(1, (time - begin) / 720);
                const eased = UTIL.EASE.inOutQuad(t);
                marker_state = {
                  x: from_point.x + (to_point.x - from_point.x) * eased,
                  y: from_point.y + (to_point.y - from_point.y) * eased,
                  lift: -70 * 4 * t * (1 - t),
                  grow: 1 + 0.12 * Math.sin(Math.PI * t),
                };
                placeItem(marker, marker_state.x, marker_state.y, dom.map_scroll.scrollTop, marker_state.grow, marker_state.lift);
                if (t < 1) requestAnimationFrame(step);
                else resolve();
              };
              requestAnimationFrame(step);
            });
            if (!alive()) return false;
          }
          marker_override = null;
          placeMarker(advance.to);
          refreshNodes();
          const unlocked_node = live_nodes.get(advance.to);
          if (unlocked_node) unlocked_node.classList.add('is-unlocking');
          const burst = document.createElement('div');
          burst.className = 'map-burst';
          burst.setAttribute('aria-hidden', 'true');
          burst.map_x = node_point.x;
          burst.map_y = node_point.y;
          burst.style.zIndex = String(4 * Z_BASE - 1);
          bursts.add(burst);
          dom.map_nodes.appendChild(burst);
          placeItem(burst, burst.map_x, burst.map_y, dom.map_scroll.scrollTop);
          setTimeout(() => {
            bursts.delete(burst);
            burst.remove();
          }, 900);
          hooks.sound('unlock');
          hooks.haptic('medium');
          hooks.announce(`Level ${advance.to} unlocked!`);
          await pause(600);
          if (unlocked_node) unlocked_node.classList.remove('is-unlocking');
        } else {
          await pause(200);
        }
        if (finished_node) finished_node.classList.remove('just-finished');
        dom.map_scroll.classList.remove('is-advancing');
        return alive();
      })().then((finished) => {
        dom.map_scroll.classList.remove('is-advancing');
        return finished;
      });
    }

    return {
      render,
      layout() {
        if (!save) return;
        const keep = levelAtHeight(total_height - (dom.map_scroll.scrollTop + dom.map_scroll.clientHeight * 0.58));
        layout();
        dom.map_scroll.scrollTop = scrollTopFor(Math.round(keep));
        placeMarker(marker_level);
        redraw();
      },
      refresh(next_save) {
        save = next_save || save;
        refreshNodes();
        placeMarker(Math.min(furthest(), last_level));
      },
      jumpTo,
      jumpToMine() {
        return jumpTo(Math.min(furthest(), last_level), true);
      },
      leave() {
        generation += 1;
        clearTimeout(prefetch_timer);
        dom.map_scroll.classList.remove('is-advancing');
      },
      get liveNodeCount() {
        return live_nodes.size;
      },
      get renderedRange() {
        return Object.assign({}, rendered);
      },
      get lastLevel() {
        return last_level;
      },
      scrollTopFor,
      levelAtHeight,
      heightOf,
      get scenerySize() {
        return scenery_cache.size;
      },
      get landsPainted() {
        return lands_painted;
      },
      /** Where lands are painted: 'worker' (off the main thread) or 'main'. */
      get painter() {
        return painter ? 'worker' : 'main';
      },
      /** 'webgl2', 'webgl' or '2d': what draws the world. */
      get renderer() {
        if (!gl) return '2d';
        return gl.webgl2 ? 'webgl2' : 'webgl';
      },
    };
  }

  SC.MAP = { createMap, NODE_SPACING, EPISODE_GAP, MAX_LIVE_NODES, WORLD, buildWorld };
})(typeof window !== 'undefined' ? window : globalThis);
