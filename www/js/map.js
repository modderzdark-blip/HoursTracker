// MAP: the level map, virtualized for 20,000+ levels.
// Like the original's map today: a candy road winding up through a painted land, level 1 at the bottom, split into
// episodes of 15 levels. Each episode is its own piece of land (a scenery family: meadow, lollipop forest, snowy peaks
// ...) full of round, shaded props, with clouds and a ribbon banner where it begins. Round glossy level buttons sit on
// the road. Only the nodes near the viewport exist in the DOM (a recycled pool of about 60 buttons) and only the visible
// episodes' land is painted, so memory and frame time are the same on level 20 and on level 19,000.
(function attachMap(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const LEVELS = SC.LEVELS;
  const SCENERY = SC.SCENERY;
  const SPRITES = SC.SPRITES;
  const STORAGE = SC.STORAGE;
  const UTIL = SC.UTIL;

  const NODE_SPACING = 86;
  const EPISODE_GAP = 230;
  const TOP_PADDING = 260;
  const BOTTOM_PADDING = 250;
  const OVERSCAN_PX = 700;
  const MAX_LIVE_NODES = 60;
  const SCENERY_CACHE = 4;
  const ROAD_HALF_WIDTH = 21;
  const ROAD_CANDIES = ['#ff5c8a', '#ffb347', '#ffe066', '#5fe0a8', '#6cb8ff', '#b57bff'];

  function createMap(dom, hooks) {
    const EPISODE = LEVELS.EPISODE_SIZE;
    let save = null;
    let last_level = 1; // the highest node drawn (the end cap sits after it)
    let width = 360;
    let total_height = 1000;
    let rendered = { first: 0, last: -1 };
    let marker_level = 1;
    let marker_override = null;
    let scroll_frame = 0;
    let scenery_dirty = true;
    let generation = 0;
    const node_pool = [];
    const live_nodes = new Map(); // level -> button
    const episode_cards = new Map(); // episode -> element
    const scenery_cache = new Map(); // episode -> canvas (LRU)
    let end_cap = null;
    let marker = null;

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

    /** The road winds left and right in long, smooth bends (a few levels per crossing), like the original's. */
    function pointOf(level_number) {
      const swing = Math.sin(level_number * 0.55 + 0.4) * 0.3 + Math.sin(level_number * 0.23 + 1.1) * 0.05;
      return { x: width / 2 + swing * width, y: total_height - heightOf(level_number) };
    }

    /** Points along the road from level `first` to `last` (the same curve the road is drawn with). */
    function roadPoints(first, last, map_x, map_y) {
      const points = [];
      for (let level_number = first; level_number <= last; level_number += 1) {
        const point = pointOf(level_number);
        const current = { x: point.x + map_x, y: point.y + map_y };
        if (points.length) {
          const previous = points[points.length - 1];
          const mid_y = (previous.y + current.y) / 2;
          for (let step = 1; step <= 8; step += 1) {
            const t = step / 8;
            const u = 1 - t;
            points.push({
              x: u * u * u * previous.x + 3 * u * u * t * previous.x + 3 * u * t * t * current.x + t * t * t * current.x,
              y: u * u * u * previous.y + 3 * u * u * t * mid_y + 3 * u * t * t * mid_y + t * t * t * current.y,
            });
          }
        } else {
          points.push(current);
        }
      }
      return points;
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
      node.style.left = `${point.x}px`;
      node.style.top = `${point.y}px`;
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
      if (is_current && hooks.heartsOn()) html += `<span class="node-cost">${hooks.icon('heart')}1</span>`;
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
      // On the cloud seam where this episode's land begins (between the previous episode's last level and its first).
      card.style.top = `${total_height - (BOTTOM_PADDING + (episode - 1) * blockHeight())}px`;
      return card;
    }

    /** Creates, recycles and removes nodes so only the ones near the viewport exist. */
    function updateNodes() {
      const top = dom.map_scroll.scrollTop - OVERSCAN_PX;
      const bottom = dom.map_scroll.scrollTop + dom.map_scroll.clientHeight + OVERSCAN_PX;
      let range = levelsInRange(top, bottom);
      if (range.last - range.first + 1 > MAX_LIVE_NODES) {
        const center = Math.round(levelAtHeight(total_height - (dom.map_scroll.scrollTop + dom.map_scroll.clientHeight / 2)));
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
      const first_episode = LEVELS.episodeOf(range.first);
      const last_episode = LEVELS.episodeOf(Math.max(range.first, range.last));
      episode_cards.forEach((card, episode) => {
        if (episode < first_episode || episode > last_episode) {
          card.remove();
          episode_cards.delete(episode);
        }
      });
      for (let episode = first_episode; episode <= last_episode; episode += 1) {
        if (episode_cards.has(episode)) continue;
        const card = episodeCard(episode);
        episode_cards.set(episode, card);
        dom.map_nodes.appendChild(card);
      }
      rendered = range;
    }

    // ---------------------------------------------------------------- scenery (only the visible episodes)

    function sceneryFor(episode) {
      if (scenery_cache.has(episode)) {
        const cached = scenery_cache.get(episode);
        scenery_cache.delete(episode);
        scenery_cache.set(episode, cached);
        return cached;
      }
      const block = blockHeight();
      const ratio = Math.min(1.5, root.devicePixelRatio || 1);
      const canvas = SPRITES.createCanvas(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(block * ratio)));
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      const scenery = LEVELS.sceneryOf(episode);
      // The road through this episode (one level beyond each end), in the land's own coordinates.
      const block_top = total_height - (BOTTOM_PADDING + episode * block);
      const range = LEVELS.episodeRange(episode);
      const path = roadPoints(Math.max(1, range.first - 1), range.last + 1, 0, -block_top);
      SCENERY.paintLand(ctx, width, block, scenery, path, ROAD_HALF_WIDTH);
      scenery_cache.set(episode, canvas);
      while (scenery_cache.size > SCENERY_CACHE) scenery_cache.delete(scenery_cache.keys().next().value);
      return canvas;
    }

    function paintScenery() {
      scenery_dirty = false;
      const canvas = dom.map_canvas;
      const view_w = dom.map_scroll.clientWidth || width;
      const view_h = dom.map_scroll.clientHeight || 600;
      const ratio = Math.min(2, root.devicePixelRatio || 1);
      if (canvas.width !== Math.round(view_w * ratio) || canvas.height !== Math.round(view_h * ratio)) {
        canvas.width = Math.round(view_w * ratio);
        canvas.height = Math.round(view_h * ratio);
        canvas.style.width = `${view_w}px`;
        canvas.style.height = `${view_h}px`;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, view_w, view_h);
      const scroll_top = dom.map_scroll.scrollTop;
      const offset_x = (view_w - width) / 2;
      const block = blockHeight();
      const top_level = levelAtHeight(total_height - scroll_top);
      const bottom_level = levelAtHeight(total_height - scroll_top - view_h);
      const first_episode = Math.max(1, LEVELS.episodeOf(Math.max(1, Math.floor(bottom_level))) - 1);
      const last_episode = LEVELS.episodeOf(Math.max(1, Math.ceil(top_level))) + 1;
      ctx.fillStyle = SCENERY.landFor(LEVELS.sceneryOf(Math.max(1, LEVELS.episodeOf(Math.max(1, Math.round(top_level)))))).ground;
      ctx.fillRect(0, 0, view_w, view_h);
      for (let episode = first_episode; episode <= last_episode; episode += 1) {
        const block_bottom = total_height - (BOTTOM_PADDING + (episode - 1) * block);
        const block_top = block_bottom - block;
        if (block_bottom < scroll_top || block_top > scroll_top + view_h) continue;
        ctx.drawImage(sceneryFor(episode), offset_x, block_top - scroll_top, width, block);
      }
      // Below level 1: the first episode's ground continues.
      const map_bottom = total_height - BOTTOM_PADDING;
      if (map_bottom < scroll_top + view_h) {
        ctx.fillStyle = SCENERY.landFor(LEVELS.sceneryOf(1)).ground;
        ctx.fillRect(0, map_bottom - scroll_top, view_w, view_h);
      }
      paintPath(ctx, scroll_top, offset_x);
    }

    /**
     * The candy road between the visible nodes: a wide, raised biscuit road with a soft shadow, a rim and a row of little
     * glossy candies down the middle.
     */
    function paintPath(ctx, scroll_top, offset_x) {
      if (rendered.last < rendered.first) return;
      const first = Math.max(1, rendered.first - 1);
      const last = Math.min(last_level + 1, rendered.last + 1);
      if (last <= first) return;
      const points = roadPoints(first, last, offset_x, -scroll_top);
      const trace = (dy) => {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y + dy);
        for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y + dy);
      };
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      trace(6);
      ctx.strokeStyle = 'rgba(40,20,60,0.22)';
      ctx.lineWidth = ROAD_HALF_WIDTH * 2 + 6;
      ctx.stroke();
      trace(0);
      ctx.strokeStyle = '#e8b47e';
      ctx.lineWidth = ROAD_HALF_WIDTH * 2 + 6;
      ctx.stroke();
      trace(0);
      ctx.strokeStyle = '#fff1d8';
      ctx.lineWidth = ROAD_HALF_WIDTH * 2 - 2;
      ctx.stroke();
      trace(-4);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = ROAD_HALF_WIDTH * 0.7;
      ctx.stroke();
      ctx.restore();
      // Little candies spaced evenly along each stretch of road between two levels (fixed to the stretch, so they stay in
      // place while the map scrolls).
      const view_bottom = (dom.map_scroll.clientHeight || 600) + 10;
      for (let level_number = first; level_number < last; level_number += 1) {
        const stretch = roadPoints(level_number, level_number + 1, offset_x, -scroll_top);
        if (Math.max(stretch[0].y, stretch[stretch.length - 1].y) < -10 || Math.min(stretch[0].y, stretch[stretch.length - 1].y) > view_bottom) continue;
        const lengths = [0];
        for (let index = 1; index < stretch.length; index += 1) lengths.push(lengths[index - 1] + Math.hypot(stretch[index].x - stretch[index - 1].x, stretch[index].y - stretch[index - 1].y));
        const total = lengths[lengths.length - 1];
        const count = Math.max(1, Math.round(total / 24));
        for (let candy = 1; candy < count; candy += 1) {
          const target = (candy / count) * total;
          let index = 1;
          while (index < lengths.length - 1 && lengths[index] < target) index += 1;
          const t = (target - lengths[index - 1]) / Math.max(0.001, lengths[index] - lengths[index - 1]);
          const x = stretch[index - 1].x + (stretch[index].x - stretch[index - 1].x) * t;
          const y = stretch[index - 1].y + (stretch[index].y - stretch[index - 1].y) * t;
          const color = ROAD_CANDIES[(level_number * 5 + candy) % ROAD_CANDIES.length];
          const glow = ctx.createRadialGradient(x - 1.6, y - 1.8, 0.4, x, y, 5);
          glow.addColorStop(0, '#ffffff');
          glow.addColorStop(0.35, color);
          glow.addColorStop(1, SCENERY.shade(color, -0.2));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, 4.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function onScroll() {
      if (scroll_frame) return;
      scroll_frame = requestAnimationFrame(() => {
        scroll_frame = 0;
        updateNodes();
        paintScenery();
      });
    }
    dom.map_scroll.addEventListener('scroll', onScroll, { passive: true });

    // ---------------------------------------------------------------- marker (the player's avatar)

    /** Where the avatar stands: beside its level, on the side away from where the road goes next. */
    function markerPoint(level_number) {
      const point = pointOf(level_number);
      const side = pointOf(level_number + 1).x > point.x ? -1 : 1;
      return { x: point.x + side * 40, y: point.y - 46 };
    }

    function placeMarker(level_number) {
      if (!marker) {
        marker = document.createElement('div');
        marker.className = 'map-marker';
        marker.setAttribute('aria-hidden', 'true');
      }
      const initial = save && save.player_name ? save.player_name.trim().charAt(0).toUpperCase() : '';
      marker.innerHTML = initial ? `<span>${initial}</span>` : `<img src="${hooks.iconUrl('pip', 64)}" alt="">`;
      const point = markerPoint(level_number);
      marker.style.left = `${point.x}px`;
      marker.style.top = `${point.y}px`;
      if (!marker.parentNode) dom.map_nodes.appendChild(marker);
      marker_level = level_number;
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
      end_cap.style.left = `${point.x}px`;
      end_cap.style.top = `${point.y}px`;
      if (!end_cap.parentNode) dom.map_nodes.appendChild(end_cap);
    }

    // ---------------------------------------------------------------- public

    function layout() {
      width = Math.min(dom.map_scroll.clientWidth || 360, 760);
      last_level = Math.max(shipped(), save ? save.unlocked - 1 : 1, 1);
      total_height = TOP_PADDING + heightOf(last_level + 1) + BOTTOM_PADDING * 0.2;
      dom.map_inner.style.width = `${width}px`;
      dom.map_inner.style.height = `${total_height}px`;
      scenery_cache.clear();
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
        dom.map_scroll.scrollTop = target;
        updateNodes();
        paintScenery();
        return Promise.resolve(true);
      }
      return animateScroll(target, 650);
    }

    function animateScroll(target, ms) {
      const my_generation = generation;
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
          if (my_generation !== generation) return resolve(false);
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
      updateNodes();
      placeMarker(hop ? advance.from : Math.min(reached, last_level));
      paintScenery();
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
          if (!reduced && marker.animate) {
            const frames = [];
            for (let index = 0; index <= 12; index += 1) {
              const t = index / 12;
              const lift = -70 * 4 * t * (1 - t);
              frames.push({ transform: `translate(${(to_point.x - from_point.x) * t}px, ${(to_point.y - from_point.y) * t + lift}px) scale(${1 + 0.12 * Math.sin(Math.PI * t)})` });
            }
            hooks.sound('hop');
            await new Promise((resolve) => {
              const flight = marker.animate(frames, { duration: 720, easing: 'ease-in-out' });
              flight.onfinish = resolve;
              flight.oncancel = resolve;
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
          burst.style.left = `${node_point.x}px`;
          burst.style.top = `${node_point.y}px`;
          dom.map_nodes.appendChild(burst);
          setTimeout(() => burst.remove(), 900);
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
        updateNodes();
        placeMarker(marker_level);
        paintScenery();
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
    };
  }

  SC.MAP = { createMap, NODE_SPACING, EPISODE_GAP, MAX_LIVE_NODES };
})(typeof window !== 'undefined' ? window : globalThis);
