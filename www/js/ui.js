// UI: DOM screens, HUD, map, modals, banners, toasts and the accessible live region.
(function attachUi(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const CONFIG = SC.CONFIG;
  const ART = SC.ART;
  const LOGIC = SC.LOGIC;
  const UTIL = SC.UTIL;

  // ---------------------------------------------------------------- icons (inline SVG, no icon fonts)
  const ICONS = {
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.6" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.8v14.4c0 .9 1 1.4 1.7.9l10.3-7.2a1.1 1.1 0 0 0 0-1.8L9.7 3.9C9 3.4 8 3.9 8 4.8z" fill="currentColor"/></svg>',
    hint: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a6.8 6.8 0 0 0-4 12.3c.6.5 1 1.2 1 2V18h6v-1.2c0-.8.4-1.5 1-2A6.8 6.8 0 0 0 12 2.5z" fill="currentColor"/><rect x="9" y="19" width="6" height="2.6" rx="1.2" fill="currentColor"/><path d="M10 7.5a3 3 0 0 1 3-1.5" stroke="#fff6" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
    sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.2h3.3L12 5v14l-4.7-4.2H4z" fill="currentColor"/><path d="M15.2 8.8a4.5 4.5 0 0 1 0 6.4M17.8 6.2a8.2 8.2 0 0 1 0 11.6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.2h3.3L12 5v14l-4.7-4.2H4z" fill="currentColor"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zm8.6 5.3l-1.9-.5a6.9 6.9 0 0 1-.7 1.7l1 1.7-1.9 1.9-1.7-1a6.9 6.9 0 0 1-1.7.7l-.5 1.9h-2.6l-.5-1.9a6.9 6.9 0 0 1-1.7-.7l-1.7 1-1.9-1.9 1-1.7a6.9 6.9 0 0 1-.7-1.7l-1.9-.5v-2.6l1.9-.5c.2-.6.4-1.2.7-1.7l-1-1.7 1.9-1.9 1.7 1c.5-.3 1.1-.5 1.7-.7l.5-1.9h2.6l.5 1.9c.6.2 1.2.4 1.7.7l1.7-1 1.9 1.9-1 1.7c.3.5.5 1.1.7 1.7l1.9.5z" fill="currentColor"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8.8a3.2 3.2 0 0 1 6.2 1c0 2.2-3.2 2.6-3.2 4.7" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round"/><circle cx="12" cy="19" r="1.8" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" stroke="currentColor" stroke-width="2.4" fill="none"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#13b874"/><path d="M7 12.4l3.2 3.2L17.2 8.6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.1l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.8z" fill="#ffd34d" stroke="#a3205f" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.4 9.6l2.3-.3 1-2.2" stroke="#fff9" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    star_empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.1l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.8z" fill="rgba(106,27,90,0.16)" stroke="rgba(106,27,90,0.4)" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.1-5" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M18.5 3.5v4.5H14" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function icon(name) {
    return ICONS[name] || '';
  }

  // ---------------------------------------------------------------- canvas-painted images for the DOM
  const image_cache = new Map();
  let icon_theme = 'gummy';
  let icon_colorblind = false;

  function paintedImage(key, size, painter) {
    const cache_key = `${key}:${size}:${icon_theme}:${icon_colorblind}`;
    if (image_cache.has(cache_key)) return image_cache.get(cache_key);
    SC.ART_FORCE_DOM_CANVAS = true;
    const canvas = ART.createCanvas(size * 2, size * 2);
    SC.ART_FORCE_DOM_CANVAS = false;
    const ctx = canvas.getContext('2d');
    painter(ctx, size * 2);
    const url = canvas.toDataURL('image/png');
    image_cache.set(cache_key, url);
    return url;
  }

  function candyImage(color, special, size) {
    return paintedImage(`candy-${color}-${special || 'none'}`, size || 48, (ctx, pixels) => {
      ART.paintSpecial(ctx, pixels / 2, pixels / 2, pixels * 0.42, color, special || 'none', { theme: icon_theme, colorblind: icon_colorblind, scale: 2 });
    });
  }

  function cherryImage(size) {
    return paintedImage('cherry', size || 48, (ctx, pixels) => ART.paintCherry(ctx, pixels / 2, pixels / 2, pixels * 0.42, 2));
  }

  function jellyImage(size, layers) {
    return paintedImage(`jelly-${layers || 1}`, size || 48, (ctx, pixels) => {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(pixels * 0.06, pixels * 0.06, pixels * 0.88, pixels * 0.88);
      ART.paintJelly(ctx, 0, 0, pixels, layers || 1, 2);
    });
  }

  function frostingImage(size, layers) {
    return paintedImage(`frosting-${layers}`, size || 48, (ctx, pixels) => ART.paintFrosting(ctx, pixels / 2, pixels / 2, pixels, layers, 2));
  }

  function scoreImage(size) {
    return paintedImage('score-star', size || 48, (ctx, pixels) => {
      ctx.fillStyle = '#ffd34d';
      ctx.strokeStyle = '#a3205f';
      ctx.lineWidth = pixels * 0.05;
      ctx.lineJoin = 'round';
      SC.RENDER.drawStar(ctx, pixels / 2, pixels / 2 + pixels * 0.03, pixels * 0.44, -Math.PI / 2, 5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(pixels * 0.42, pixels * 0.38, pixels * 0.1, pixels * 0.05, -0.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function goalIcon(goal, size) {
    if (goal.type === 'collect') return candyImage(goal.color, 'none', size);
    if (goal.type === 'jelly') return jellyImage(size, 1);
    if (goal.type === 'ingredients') return cherryImage(size);
    return scoreImage(size);
  }

  function goalLabel(goal) {
    if (goal.type === 'collect') return `${CONFIG.CANDIES[goal.color].name}s`;
    if (goal.type === 'jelly') return 'Glaze';
    if (goal.type === 'ingredients') return 'Cherries';
    return 'Score';
  }

  function element(tag, class_name, attributes) {
    const node = document.createElement(tag);
    if (class_name) node.className = class_name;
    if (attributes) {
      Object.keys(attributes).forEach((key) => {
        if (key === 'text') node.textContent = attributes[key];
        else if (key === 'html') node.innerHTML = attributes[key];
        else node.setAttribute(key, attributes[key]);
      });
    }
    return node;
  }

  function glossyHeading(tag, text, class_name) {
    return element(tag, `glossy-text ${class_name || ''}`.trim(), { 'data-text': text, text });
  }

  function button(text, class_name, on_click, label) {
    const node = element('button', class_name, { type: 'button' });
    node.textContent = text;
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', on_click);
    return node;
  }

  function iconButton(icon_name, label, on_click, class_name) {
    const node = element('button', class_name || 'round', { type: 'button', 'aria-label': label, html: icon(icon_name) });
    node.addEventListener('click', on_click);
    return node;
  }

  function createUi(dom, hooks) {
    const modal_handles = [];
    let toast_timer = null;
    let banner_timer = null;
    let hud_level = null;
    let hud_goal_nodes = [];
    let displayed_score = 0;
    let score_target = 0;
    let score_animation = null;

    document.querySelectorAll('[data-icon]').forEach((node) => {
      node.innerHTML = icon(node.getAttribute('data-icon'));
    });

    function clickSound() {
      hooks.sound('click');
    }

    const ui = {
      icon,
      candyImage,
      cherryImage,
      showScreen(screen_name) {
        ['title', 'map', 'game'].forEach((name) => dom[`screen_${name}`].classList.toggle('is-active', name === screen_name));
        dom.app.classList.toggle('is-playing', screen_name === 'game');
      },
      setIconStyle(theme, colorblind) {
        if (theme !== icon_theme || colorblind !== icon_colorblind) {
          icon_theme = theme;
          icon_colorblind = colorblind;
        }
      },
      setAccent(accent) {
        const style = dom.app.style;
        style.setProperty('--bg1', accent.background[0]);
        style.setProperty('--bg2', accent.background[1]);
        style.setProperty('--bg3', accent.background[2]);
        style.setProperty('--btn1', accent.button[0]);
        style.setProperty('--btn2', accent.button[1]);
        style.setProperty('--btn-depth', accent.depth);
        style.setProperty('--ink', accent.ink);
        document.body.style.background = accent.background[0];
      },
      setReducedMotion(reduced) {
        dom.app.classList.toggle('reduced-motion', reduced);
      },

      // ------------------------------------------------------------ title
      renderTitle(player_name) {
        dom.title_greeting.textContent = player_name ? `Hi, ${player_name}!` : 'Welcome, sweet tooth!';
        dom.title_version.textContent = `v${CONFIG.VERSION} · all art & sound made by code`;
        dom.title_candies.innerHTML = '';
        const spots = [[8, 12, -12], [78, 9, 10], [4, 72, 8], [80, 76, -8], [16, 88, 14], [70, 88, -14], [84, 56, 6], [2, 56, -6]];
        spots.forEach(([left, top, tilt], index) => {
          const image = element('img', '', { src: candyImage(index % 6, index === 6 ? 'stripe_row' : index === 7 ? 'wrapped' : 'none', 64), alt: '' });
          image.style.left = `${left}%`;
          image.style.top = `${top}%`;
          image.style.setProperty('--tilt', `${tilt}deg`);
          image.style.animationDelay = `${index * -0.7}s`;
          dom.title_candies.appendChild(image);
        });
      },

      // ------------------------------------------------------------ map
      renderMap(levels, save, on_select) {
        const width = Math.min(dom.map_scroll.clientWidth || 360, 560);
        const spacing = 150;
        const height = (levels.length + 1) * spacing + 220;
        dom.map_inner.style.width = `${width}px`;
        dom.map_inner.style.height = `${height}px`;
        const positions = [];
        for (let index = 0; index <= levels.length; index += 1) {
          const y = height - 140 - index * spacing;
          const x = width / 2 + Math.sin(index * 1.15 + 0.4) * width * 0.27;
          positions.push({ x, y });
        }
        paintMapScenery(dom.map_canvas, width, height, positions);
        dom.map_nodes.innerHTML = '';
        levels.forEach((level, index) => {
          const record = save.levels[level.id];
          const unlocked = level.id <= save.unlocked;
          const is_current = level.id === Math.min(save.unlocked, levels.length);
          const node = element('button', `map-node${unlocked ? '' : ' is-locked'}${is_current ? ' is-current' : ''}`, { type: 'button' });
          node.style.left = `${positions[index].x}px`;
          node.style.top = `${positions[index].y}px`;
          const stars = record ? record.best_stars : 0;
          node.setAttribute('aria-label', unlocked ? `Level ${level.id}, ${level.name}, ${stars} of 3 stars` : `Level ${level.id}, locked`);
          node.innerHTML = unlocked ? `<span>${level.id}</span>` : icon('lock');
          if (unlocked) {
            const star_holder = element('span', 'node-stars');
            for (let star_index = 0; star_index < 3; star_index += 1) star_holder.insertAdjacentHTML('beforeend', icon(star_index < stars ? 'star' : 'star_empty'));
            node.appendChild(star_holder);
          }
          node.dataset.levelId = String(level.id);
          node.addEventListener('click', () => {
            clickSound();
            if (unlocked) on_select(level.id);
            else ui.toast('Finish the previous level to unlock this one!');
          });
          dom.map_nodes.appendChild(node);
        });
        const soon = element('button', 'map-node is-soon', { type: 'button', 'aria-label': 'More levels coming soon' });
        soon.innerHTML = '<span>More levels<br>coming soon</span>';
        soon.style.left = `${positions[levels.length].x}px`;
        soon.style.top = `${positions[levels.length].y}px`;
        soon.addEventListener('click', () => {
          clickSound();
          ui.toast('New levels are on the way!');
        });
        dom.map_nodes.appendChild(soon);
        const current_index = Math.min(save.unlocked, levels.length) - 1;
        const target_scroll = positions[current_index].y - dom.map_scroll.clientHeight * 0.55;
        dom.map_scroll.scrollTop = Math.max(0, target_scroll);
      },

      // ------------------------------------------------------------ HUD
      setupHud(level, state) {
        hud_level = level;
        dom.hud_level.textContent = `Level ${level.id}`;
        dom.hud_level.setAttribute('aria-label', `Level ${level.id}, ${level.name}`);
        dom.hud_goal_list.innerHTML = '';
        hud_goal_nodes = level.goals.map((goal) => {
          const node = element('div', 'goal');
          const goal_image = element('img', 'goal-icon', { src: goalIcon(goal, 30), alt: '' });
          const count = element('span', 'goal-count');
          node.appendChild(goal_image);
          node.appendChild(count);
          dom.hud_goal_list.appendChild(node);
          return { node, count, goal };
        });
        const top = level.stars[2] * 1.1;
        level.stars.forEach((threshold, index) => {
          const mark = dom[`star_mark_${index}`];
          mark.style.left = `${Math.min(97, (threshold / top) * 100)}%`;
          mark.innerHTML = icon('star_empty');
        });
        displayed_score = state.score;
        score_target = state.score;
        dom.hud_score.textContent = String(state.score);
        ui.updateHud({ moves: state.moves_left, score: state.score, progress: LOGIC.goalProgress(state) }, true);
      },
      updateHud(values, immediate) {
        if (values.moves !== undefined) {
          dom.hud_moves.textContent = String(values.moves);
          dom.hud_moves.classList.toggle('is-low', values.moves <= 5);
        }
        if (values.score !== undefined) ui.setScore(values.score, immediate);
        if (values.progress) {
          values.progress.forEach((progress, index) => {
            const entry = hud_goal_nodes[index];
            if (!entry) return;
            let text;
            if (progress.type === 'score') text = progress.done ? '' : `${Math.max(0, progress.target - progress.current)}`;
            else if (progress.type === 'jelly') text = progress.done ? '' : String(progress.remaining_cells);
            else text = progress.done ? '' : String(Math.max(0, progress.target - progress.current));
            const was_done = entry.node.classList.contains('is-done');
            if (entry.count.dataset.value !== text) {
              entry.count.dataset.value = text;
              entry.node.classList.remove('is-bumped');
              void entry.node.offsetWidth;
              entry.node.classList.add('is-bumped');
            }
            if (progress.done) {
              entry.count.innerHTML = icon('check');
              entry.count.querySelector('svg').setAttribute('class', 'goal-check');
            } else {
              entry.count.textContent = text;
            }
            entry.node.classList.toggle('is-done', progress.done);
            if (progress.done && !was_done) hooks.sound('star', { index: 0 });
          });
        }
      },
      setScore(score, immediate) {
        score_target = score;
        if (immediate) {
          displayed_score = score;
          dom.hud_score.textContent = String(score);
        } else if (!score_animation) {
          const tick = () => {
            const gap = score_target - displayed_score;
            if (Math.abs(gap) < 1) {
              displayed_score = score_target;
              dom.hud_score.textContent = String(displayed_score);
              score_animation = null;
              return;
            }
            displayed_score += gap > 0 ? Math.max(1, Math.ceil(gap * 0.18)) : gap;
            dom.hud_score.textContent = String(Math.round(displayed_score));
            score_animation = requestAnimationFrame(tick);
          };
          score_animation = requestAnimationFrame(tick);
        }
        if (hud_level) {
          const top = hud_level.stars[2] * 1.1;
          dom.star_fill.style.width = `${Math.min(100, (score / top) * 100)}%`;
          hud_level.stars.forEach((threshold, index) => {
            const mark = dom[`star_mark_${index}`];
            const reached = score >= threshold;
            if (mark.dataset.reached !== String(reached)) {
              mark.dataset.reached = String(reached);
              mark.innerHTML = icon(reached ? 'star' : 'star_empty');
            }
          });
        }
      },
      goalElementCenter(goal_type) {
        const index = hud_goal_nodes.findIndex((entry) => entry.goal.type === goal_type);
        const target = index >= 0 ? hud_goal_nodes[index].node : dom.hud_goal_list;
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      setSoundButton(sound_on) {
        dom.btn_sound.innerHTML = icon(sound_on ? 'sound' : 'mute');
        dom.btn_sound.setAttribute('aria-label', sound_on ? 'Mute sound' : 'Turn sound on');
        dom.btn_sound.classList.toggle('is-off', !sound_on);
      },
      tutorial(text) {
        if (!text) {
          dom.tutorial_bubble.hidden = true;
          return;
        }
        dom.tutorial_bubble.textContent = text;
        dom.tutorial_bubble.hidden = false;
      },

      // ------------------------------------------------------------ banners, toasts, live region
      showBanner(text, rainbow, small) {
        clearTimeout(banner_timer);
        dom.banner.innerHTML = '';
        dom.banner.classList.toggle('is-small', !!small);
        const heading = element('span', `glossy-text${rainbow ? ' rainbow' : ''}`, { 'data-text': text, text });
        dom.banner.appendChild(heading);
        dom.banner.classList.remove('is-showing');
        void dom.banner.offsetWidth;
        dom.banner.classList.add('is-showing');
        banner_timer = setTimeout(() => dom.banner.classList.remove('is-showing'), 1300);
      },
      toast(text) {
        dom.toast.textContent = text;
        dom.toast.classList.add('is-showing');
        clearTimeout(toast_timer);
        toast_timer = setTimeout(() => dom.toast.classList.remove('is-showing'), 2200);
      },
      announce(text) {
        dom.live_region.textContent = '';
        setTimeout(() => {
          dom.live_region.textContent = text;
        }, 30);
      },

      // ------------------------------------------------------------ modals
      /** Opens a modal. `spec`: { id, build(container, handle), back(handle) }. Returns a handle with close(). */
      openModal(spec) {
        dom.modal_root.hidden = false;
        const modal = element('div', 'modal', { role: 'dialog', 'aria-modal': 'true', 'data-modal': spec.id });
        const handle = {
          id: spec.id,
          node: modal,
          closed: false,
          back: spec.back,
          close() {
            if (handle.closed) return;
            handle.closed = true;
            const index = modal_handles.indexOf(handle);
            if (index >= 0) modal_handles.splice(index, 1);
            modal.classList.add('is-closing');
            setTimeout(() => modal.remove(), 180);
            if (modal_handles.length === 0) setTimeout(() => {
              if (modal_handles.length === 0) dom.modal_root.hidden = true;
            }, 180);
            else modal_handles[modal_handles.length - 1].node.style.visibility = '';
            if (spec.on_close) spec.on_close();
          },
        };
        modal_handles.forEach((open_handle) => {
          open_handle.node.style.visibility = 'hidden';
        });
        modal_handles.push(handle);
        spec.build(modal, handle);
        const title = modal.querySelector('.modal-title');
        modal.setAttribute('aria-label', title ? title.textContent : spec.id);
        dom.modal_stack.appendChild(modal);
        const focus_target = modal.querySelector('[data-autofocus]') || modal.querySelector('button');
        if (focus_target && !('ontouchstart' in root)) setTimeout(() => focus_target.focus({ preventScroll: true }), 60);
        return handle;
      },
      topModal() {
        return modal_handles.length ? modal_handles[modal_handles.length - 1] : null;
      },
      closeAllModals() {
        modal_handles.slice().forEach((handle) => handle.close());
      },
      confirm(options) {
        return new Promise((resolve) => {
          ui.openModal({
            id: options.id || 'confirm',
            back: (handle) => {
              handle.close();
              resolve(false);
            },
            build(modal, handle) {
              modal.appendChild(glossyHeading('h2', options.title, 'modal-title'));
              if (options.text) modal.appendChild(element('p', '', { text: options.text }));
              const row = element('div', 'button-row');
              row.appendChild(button(options.no || 'Cancel', 'pill secondary', () => {
                clickSound();
                handle.close();
                resolve(false);
              }));
              const yes = button(options.yes || 'Yes', `pill${options.danger ? ' danger' : ''}`, () => {
                clickSound();
                handle.close();
                resolve(true);
              });
              yes.setAttribute('data-autofocus', '');
              row.appendChild(yes);
              modal.appendChild(row);
            },
          });
        });
      },

      showIntro(level, record, actions) {
        return ui.openModal({
          id: 'intro',
          back: (handle) => handle.close(),
          on_close: actions.closed,
          build(modal, handle) {
            modal.appendChild(iconButton('close', 'Close', () => {
              clickSound();
              handle.close();
            }, 'round small modal-close'));
            modal.appendChild(element('p', '', { text: `Level ${level.id}` }));
            modal.appendChild(glossyHeading('h2', level.name, 'modal-title'));
            const stars = element('div', 'star-row');
            for (let index = 0; index < 3; index += 1) stars.insertAdjacentHTML('beforeend', icon(record && record.best_stars > index ? 'star' : 'star_empty'));
            modal.appendChild(stars);
            const goals = element('div', 'intro-goals');
            level.goals.forEach((goal) => {
              const goal_card = element('div', 'intro-goal');
              goal_card.appendChild(element('img', '', { src: goalIcon(goal, 46), alt: '' }));
              let label;
              if (goal.type === 'score') label = `Score ${goal.target.toLocaleString('en-US')}`;
              else if (goal.type === 'collect') label = `Collect ${goal.count}`;
              else if (goal.type === 'jelly') label = 'Clear all glaze';
              else label = `Drop ${goal.count} cherries`;
              goal_card.appendChild(element('div', '', { text: label }));
              goal_card.setAttribute('aria-label', `${label} ${goal.type === 'collect' ? goalLabel(goal) : ''}`.trim());
              goals.appendChild(goal_card);
            });
            modal.appendChild(goals);
            const meta = element('div', 'intro-meta');
            meta.appendChild(element('span', '', { text: `${level.moves} moves` }));
            if (record && record.best_score) meta.appendChild(element('span', '', { text: `Best ${record.best_score.toLocaleString('en-US')}` }));
            modal.appendChild(meta);
            const column = element('div', 'button-column');
            const play = button('Play', 'pill pill-big', () => {
              clickSound();
              handle.close();
              actions.play();
            });
            play.setAttribute('data-autofocus', '');
            play.id = 'btn-intro-play';
            column.appendChild(play);
            modal.appendChild(column);
          },
        });
      },

      showPause(actions) {
        return ui.openModal({
          id: 'pause',
          back: () => actions.quit(),
          on_close: actions.closed,
          build(modal, handle) {
            modal.appendChild(glossyHeading('h2', 'Paused', 'modal-title'));
            const column = element('div', 'button-column');
            const resume = button('Resume', 'pill', () => {
              clickSound();
              handle.close();
              actions.resume();
            });
            resume.id = 'btn-resume';
            resume.setAttribute('data-autofocus', '');
            column.appendChild(resume);
            const restart = button('Restart', 'pill secondary', () => {
              clickSound();
              actions.restart();
            });
            restart.id = 'btn-restart';
            column.appendChild(restart);
            column.appendChild(button('Settings', 'pill secondary', () => {
              clickSound();
              actions.settings();
            }));
            const quit = button('Quit to map', 'pill secondary', () => {
              clickSound();
              actions.quit();
            });
            quit.id = 'btn-quit';
            column.appendChild(quit);
            modal.appendChild(column);
          },
        });
      },

      showWin(data, actions) {
        return ui.openModal({
          id: 'win',
          back: () => actions.map(),
          build(modal) {
            modal.appendChild(glossyHeading('h2', 'Level Complete!', 'modal-title'));
            modal.appendChild(element('p', '', { text: data.player_name ? `Great job, ${data.player_name}!` : 'Great job!' }));
            if (data.win_message) modal.appendChild(element('p', 'win-message', { text: data.win_message }));
            const stars = element('div', 'star-row big');
            const slots = [];
            for (let index = 0; index < 3; index += 1) {
              const slot = element('span', 'star-slot', { html: icon('star_empty') });
              stars.appendChild(slot);
              slots.push(slot);
            }
            modal.appendChild(stars);
            const score_line = element('div', 'final-score', { text: '0' });
            score_line.id = 'win-score';
            modal.appendChild(score_line);
            const best = element('div', 'new-best', { text: 'New best!' });
            best.hidden = true;
            modal.appendChild(best);
            const column = element('div', 'button-column');
            if (data.has_next) {
              const next = button('Next level', 'pill pill-big', () => {
                clickSound();
                actions.next();
              });
              next.id = 'btn-next';
              next.setAttribute('data-autofocus', '');
              column.appendChild(next);
            }
            const row = element('div', 'button-row');
            const replay = button('Replay', 'pill secondary', () => {
              clickSound();
              actions.replay();
            });
            replay.id = 'btn-replay';
            row.appendChild(replay);
            const map = button('Map', 'pill secondary', () => {
              clickSound();
              actions.map();
            });
            map.id = 'btn-win-map';
            row.appendChild(map);
            column.appendChild(row);
            modal.appendChild(column);
            // Count up the score, then pop the stars in with ascending pitch.
            const start = performance.now();
            const count_up = (time) => {
              const progress = Math.min(1, (time - start) / 700);
              score_line.textContent = Math.round(data.score * UTIL.EASE.outCubic(progress)).toLocaleString('en-US');
              if (progress < 1) requestAnimationFrame(count_up);
            };
            requestAnimationFrame(count_up);
            slots.forEach((slot, index) => {
              if (index >= data.stars) return;
              setTimeout(() => {
                slot.innerHTML = icon('star');
                slot.classList.add('is-popping');
                hooks.sound('star', { index });
                hooks.haptic('medium');
              }, 450 + index * 380);
            });
            setTimeout(() => {
              best.hidden = !data.is_new_best;
            }, 450 + data.stars * 380);
          },
        });
      },

      showLose(data, actions) {
        return ui.openModal({
          id: 'lose',
          back: () => actions.map(),
          build(modal) {
            modal.appendChild(glossyHeading('h2', 'Out of moves!', 'modal-title'));
            modal.appendChild(element('p', '', { text: data.player_name ? `So close, ${data.player_name}! Still to go:` : 'So close! Still to go:' }));
            const summary = element('div', 'intro-goals goal-summary');
            data.progress.forEach((progress, index) => {
              if (progress.done) return;
              const goal = data.goals[index];
              const card = element('div', 'intro-goal');
              card.appendChild(element('img', '', { src: goalIcon(goal, 46), alt: '' }));
              let text;
              if (progress.type === 'score') text = `${(progress.target - progress.current).toLocaleString('en-US')} points`;
              else if (progress.type === 'jelly') text = `${progress.remaining_cells} glaze`;
              else if (progress.type === 'ingredients') text = `${progress.target - progress.current} cherries`;
              else text = `${progress.target - progress.current} left`;
              card.appendChild(element('div', '', { text }));
              summary.appendChild(card);
            });
            modal.appendChild(summary);
            const column = element('div', 'button-column');
            const retry = button('Try again', 'pill pill-big', () => {
              clickSound();
              actions.retry();
            });
            retry.id = 'btn-retry';
            retry.setAttribute('data-autofocus', '');
            column.appendChild(retry);
            const map = button('Map', 'pill secondary', () => {
              clickSound();
              actions.map();
            });
            map.id = 'btn-lose-map';
            column.appendChild(map);
            modal.appendChild(column);
          },
        });
      },

      showNamePrompt(actions) {
        return ui.openModal({
          id: 'name',
          back: (handle) => {
            handle.close();
            actions.done('');
          },
          build(modal, handle) {
            modal.appendChild(glossyHeading('h2', 'Hello there!', 'modal-title'));
            modal.appendChild(element('p', '', { text: 'What should we call you?' }));
            const input = element('input', 'text-input', { type: 'text', maxlength: '16', placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'off', enterkeyhint: 'done' });
            input.id = 'name-input';
            modal.appendChild(input);
            const row = element('div', 'button-row');
            const skip = button('Skip', 'pill secondary', () => {
              clickSound();
              handle.close();
              actions.done('');
            });
            skip.id = 'btn-name-skip';
            row.appendChild(skip);
            const save = button("Let's play!", 'pill', () => {
              clickSound();
              handle.close();
              actions.done(input.value);
            });
            save.id = 'btn-name-save';
            row.appendChild(save);
            modal.appendChild(row);
            input.addEventListener('keydown', (event) => {
              if (event.key === 'Enter') save.click();
            });
          },
        });
      },

      showSettings(settings, player, actions) {
        return ui.openModal({
          id: 'settings',
          back: (handle) => handle.close(),
          on_close: actions.closed,
          build(modal, handle) {
            modal.classList.add('settings');
            modal.appendChild(iconButton('close', 'Close settings', () => {
              clickSound();
              handle.close();
            }, 'round small modal-close'));
            const heading = glossyHeading('h2', 'Settings', 'modal-title');
            modal.appendChild(heading);
            const section = (title) => modal.appendChild(element('h3', '', { text: title }));
            const toggleRow = (label, key, value) => {
              const row = element('div', 'setting-row');
              const toggle_id = `toggle-${key}`;
              row.appendChild(element('label', '', { text: label, for: toggle_id }));
              const toggle = element('button', 'toggle', { type: 'button', role: 'switch', 'aria-checked': String(value), 'aria-label': label, id: toggle_id });
              toggle.addEventListener('click', () => {
                const next = toggle.getAttribute('aria-checked') !== 'true';
                toggle.setAttribute('aria-checked', String(next));
                actions.change(key, next);
                clickSound();
              });
              row.appendChild(toggle);
              modal.appendChild(row);
            };
            const sliderRow = (label, key, value, minimum) => {
              const row = element('div', 'setting-row');
              row.appendChild(element('label', '', { text: label, for: `slider-${key}` }));
              const slider = element('input', '', { type: 'range', min: String(minimum || 0), max: '1', step: '0.05', value: String(value), id: `slider-${key}`, 'aria-label': label });
              slider.addEventListener('input', () => actions.change(key, parseFloat(slider.value)));
              row.appendChild(slider);
              modal.appendChild(row);
            };
            section('Sound');
            toggleRow('Sound effects', 'sfx_on', settings.sfx_on);
            sliderRow('Effects volume', 'sfx_volume', settings.sfx_volume);
            toggleRow('Music', 'music_on', settings.music_on);
            sliderRow('Music volume', 'music_volume', settings.music_volume);
            section('Feel');
            toggleRow('Haptics (vibration)', 'haptics', settings.haptics);
            toggleRow('Reduced motion', 'reduced_motion', settings.reduced_motion);
            toggleRow('Color-blind assist', 'colorblind', settings.colorblind);
            section('Candy art');
            const themes = element('div', 'choice-grid', { role: 'radiogroup', 'aria-label': 'Candy art theme' });
            CONFIG.THEMES.forEach((theme) => {
              const saved_theme = icon_theme;
              icon_theme = theme.id;
              const preview = candyImage(0, 'none', 40);
              icon_theme = saved_theme;
              const choice = element('button', 'choice', { type: 'button', role: 'radio', 'aria-checked': String(settings.theme === theme.id), 'aria-label': theme.name, 'data-theme': theme.id });
              choice.innerHTML = `<img src="${preview}" alt=""><span>${theme.name}</span>`;
              choice.addEventListener('click', () => {
                themes.querySelectorAll('.choice').forEach((other) => other.setAttribute('aria-checked', String(other === choice)));
                actions.change('theme', theme.id);
                clickSound();
              });
              themes.appendChild(choice);
            });
            modal.appendChild(themes);
            section('Colors');
            const swatches = element('div', 'swatch-grid', { role: 'radiogroup', 'aria-label': 'Accent colors' });
            CONFIG.ACCENTS.forEach((accent) => {
              const swatch = element('button', 'swatch', { type: 'button', role: 'radio', 'aria-checked': String(settings.accent === accent.id), 'aria-label': accent.name, 'data-accent': accent.id });
              swatch.style.background = `linear-gradient(135deg, ${accent.background[0]}, ${accent.background[1]} 55%, ${accent.button[1]})`;
              swatch.textContent = accent.name;
              swatch.addEventListener('click', () => {
                swatches.querySelectorAll('.swatch').forEach((other) => other.setAttribute('aria-checked', String(other === swatch)));
                actions.change('accent', accent.id);
                clickSound();
              });
              swatches.appendChild(swatch);
            });
            modal.appendChild(swatches);
            section('Make it mine');
            const name_row = element('div', 'setting-row');
            name_row.style.flexDirection = 'column';
            name_row.style.alignItems = 'stretch';
            name_row.appendChild(element('label', '', { text: 'Player name', for: 'settings-name' }));
            const name_input = element('input', 'text-input', { type: 'text', maxlength: '16', value: player.name || '', id: 'settings-name', placeholder: 'Your name', autocomplete: 'off' });
            name_input.addEventListener('change', () => actions.change('player_name', name_input.value));
            name_row.appendChild(name_input);
            modal.appendChild(name_row);
            const photo_row = element('div', 'setting-row');
            photo_row.style.flexDirection = 'column';
            photo_row.style.alignItems = 'stretch';
            photo_row.appendChild(element('label', '', { text: 'Background photo (stays on this phone)' }));
            const preview = element('div', 'photo-preview', { text: player.photo ? '' : 'No photo yet' });
            if (player.photo) preview.style.backgroundImage = `url("${player.photo}")`;
            photo_row.appendChild(preview);
            const photo_buttons = element('div', 'button-row');
            photo_buttons.style.marginTop = '4px';
            const choose = button('Choose photo', 'pill', () => {
              clickSound();
              actions.pickPhoto().then((data_url) => {
                if (data_url) {
                  preview.style.backgroundImage = `url("${data_url}")`;
                  preview.textContent = '';
                }
              });
            });
            choose.id = 'btn-choose-photo';
            photo_buttons.appendChild(choose);
            photo_buttons.appendChild(button('Remove photo', 'pill secondary', () => {
              clickSound();
              actions.removePhoto();
              preview.style.backgroundImage = '';
              preview.textContent = 'No photo yet';
            }));
            photo_row.appendChild(photo_buttons);
            modal.appendChild(photo_row);
            sliderRow('Photo brightness', 'photo_brightness', settings.photo_brightness, 0.2);
            const message_row = element('div', 'setting-row');
            message_row.style.flexDirection = 'column';
            message_row.style.alignItems = 'stretch';
            message_row.appendChild(element('label', '', { text: 'Level-complete message (optional)', for: 'settings-message' }));
            const message_input = element('input', 'text-input', { type: 'text', maxlength: '80', value: settings.win_message || '', id: 'settings-message', placeholder: 'e.g. You are amazing!', autocomplete: 'off' });
            message_input.addEventListener('change', () => actions.change('win_message', message_input.value));
            message_row.appendChild(message_input);
            modal.appendChild(message_row);
            section('Extras');
            const self_test = button('Run self-test', 'pill secondary', () => {
              clickSound();
              actions.selfTest();
            });
            self_test.id = 'btn-self-test';
            modal.appendChild(self_test);
            modal.appendChild(button('How to play', 'pill secondary', () => {
              clickSound();
              actions.help();
            }));
            const reset = button('Reset progress', 'pill danger', () => {
              clickSound();
              actions.reset();
            });
            reset.id = 'btn-reset';
            modal.appendChild(reset);
            modal.appendChild(element('p', 'help-footer', { text: `${CONFIG.GAME_TITLE} v${CONFIG.VERSION}. Everything is stored only on this device.` }));
          },
        });
      },

      showHelp() {
        return ui.openModal({
          id: 'help',
          back: (handle) => handle.close(),
          build(modal, handle) {
            modal.classList.add('help');
            modal.appendChild(iconButton('close', 'Close', () => {
              clickSound();
              handle.close();
            }, 'round small modal-close'));
            modal.appendChild(glossyHeading('h2', 'How to Play', 'modal-title'));
            const row = (image_url, html) => {
              const node = element('div', 'help-row');
              node.appendChild(element('img', '', { src: image_url, alt: '' }));
              node.appendChild(element('div', '', { html }));
              modal.appendChild(node);
            };
            modal.appendChild(element('h3', '', { text: 'Basics' }));
            row(candyImage(0, 'none', 48), 'Swap two neighboring candies (tap one, then the other, or swipe) to line up <b>3 or more</b> of the same kind.');
            row(candyImage(4, 'none', 48), 'Every candy has its own color <b>and</b> shape. Turn on <b>Color-blind assist</b> in Settings for letters too.');
            row(jellyImage(48, 2), 'Glaze: match on top of it to wipe it away. Thick glaze needs two hits.');
            row(frostingImage(48, 2), 'Frosting blocks swaps. Match next to it (or blast it) to crack it.');
            row(cherryImage(48), 'Cherries: clear the candies below them to drop them into the trays at the bottom.');
            modal.appendChild(element('h3', '', { text: 'Special candies' }));
            row(candyImage(3, 'stripe_col', 48), '<b>Match 4 in a line</b>: Striped candy. Its stripes point the way it clears: a whole row or column.');
            row(candyImage(5, 'wrapped', 48), '<b>Match an L, T or +</b>: Wrapped candy. Explodes 3×3, then again after the board settles.');
            row(candyImage(0, 'bomb', 48), '<b>Match 5 in a line</b>: Color Bomb. Swap it with a candy to clear every candy of that color.');
            modal.appendChild(element('h3', '', { text: 'Combos (swap two specials)' }));
            const combos = element('table', 'help-table');
            [
              ['Striped + Striped', 'Row and column cross'],
              ['Striped + Wrapped', '3 rows and 3 columns'],
              ['Wrapped + Wrapped', '5×5 blast, twice'],
              ['Bomb + Striped', 'That color turns striped and fires'],
              ['Bomb + Wrapped', 'That color turns wrapped and explodes'],
              ['Bomb + Bomb', 'Clears the whole board'],
            ].forEach(([pair, effect]) => combos.insertAdjacentHTML('beforeend', `<tr><td>${pair}</td><td>${effect}</td></tr>`));
            modal.appendChild(combos);
            modal.appendChild(element('h3', '', { text: 'Scoring' }));
            const scoring = element('table', 'help-table');
            const points = LOGIC.SCORING;
            [
              ['Match of 3 / 4 / 5 / 6', `${LOGIC.matchPoints(3)} / ${LOGIC.matchPoints(4)} / ${LOGIC.matchPoints(5)} / ${LOGIC.matchPoints(6)}`],
              ['Make striped / wrapped / bomb', `${points.CREATE_STRIPE} / ${points.CREATE_WRAPPED} / ${points.CREATE_BOMB}`],
              ['Each candy cleared by a special', String(points.ACTIVATION_PER_CANDY)],
              ['Each special set off', String(points.ACTIVATION_PER_SPECIAL)],
              ['Cascades', '×1, ×1.5, ×2, ×2.5 … up to ×4'],
              ['Cherry delivered', String(points.INGREDIENT)],
              ['Glaze layer / frosting layer', `${points.JELLY_LAYER} / ${points.FROSTING_LAYER}`],
              ['Each move left at the end', `${points.END_BONUS_PER_MOVE} + a striped candy`],
            ].forEach(([what, value]) => scoring.insertAdjacentHTML('beforeend', `<tr><td>${what}</td><td>${value}</td></tr>`));
            modal.appendChild(scoring);
            modal.appendChild(element('p', 'help-footer', { text: 'No moves left? The board reshuffles by itself. Stuck? Tap the light bulb for a free hint. New levels are just data: append one entry to www/js/levels.js.' }));
          },
        });
      },

      showSelfTest(runner) {
        return ui.openModal({
          id: 'selftest',
          back: (handle) => {
            runner.cancel();
            handle.close();
          },
          build(modal, handle) {
            modal.appendChild(iconButton('close', 'Close', () => {
              clickSound();
              runner.cancel();
              handle.close();
            }, 'round small modal-close'));
            modal.appendChild(glossyHeading('h2', 'Self-test', 'modal-title'));
            const status = element('div', 'selftest-status is-running', { text: 'Running…' });
            status.id = 'selftest-status';
            modal.appendChild(status);
            const report = element('pre', 'selftest-report', { text: '' });
            report.id = 'selftest-report';
            modal.appendChild(report);
            const copy = button('Copy report', 'pill', () => {
              clickSound();
              const text = report.textContent;
              const fallback = () => {
                const area = element('textarea');
                area.value = text;
                document.body.appendChild(area);
                area.select();
                try {
                  document.execCommand('copy');
                  ui.toast('Report copied');
                } catch (copy_error) {
                  ui.toast('Select the report to copy it');
                }
                area.remove();
              };
              if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => ui.toast('Report copied'), fallback);
              else fallback();
            });
            copy.id = 'btn-copy-report';
            copy.disabled = true;
            modal.appendChild(copy);
            runner.start({
              line(text) {
                report.textContent += `${text}\n`;
                report.scrollTop = report.scrollHeight;
              },
              finish(passed, summary) {
                status.className = `selftest-status ${passed ? 'is-pass' : 'is-fail'}`;
                status.textContent = summary;
                copy.disabled = false;
              },
            });
          },
        });
      },
    };
    return ui;
  }

  // ---------------------------------------------------------------- map scenery (procedural)
  function paintMapScenery(canvas, width, height, positions) {
    const ratio = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const random = UTIL.createRng(2024);
    // Clouds.
    for (let index = 0; index < 9; index += 1) {
      const x = random() * width;
      const y = random() * height;
      const size = 26 + random() * 30;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      [[0, 0, 1], [0.9, 0.15, 0.75], [-0.9, 0.2, 0.7], [0.35, -0.45, 0.8]].forEach(([dx, dy, scale]) => {
        ctx.beginPath();
        ctx.arc(x + dx * size, y + dy * size, size * scale, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // Gumdrop hills along the sides.
    for (let y = 120; y < height; y += 170) {
      [-1, 1].forEach((side) => {
        const x = side < 0 ? random() * width * 0.16 : width - random() * width * 0.16;
        const radius = 34 + random() * 26;
        const candy = CONFIG.CANDIES[Math.floor(random() * 6)];
        const hill = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.5, radius * 0.1, x, y, radius * 1.2);
        hill.addColorStop(0, candy.highlight);
        hill.addColorStop(0.6, candy.base);
        hill.addColorStop(1, candy.shadow);
        ctx.fillStyle = hill;
        ctx.beginPath();
        ctx.arc(x, y, radius, Math.PI, 0);
        ctx.quadraticCurveTo(x + radius, y + radius * 0.25, x, y + radius * 0.22);
        ctx.quadraticCurveTo(x - radius, y + radius * 0.25, x - radius, y);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        for (let sugar = 0; sugar < 8; sugar += 1) ctx.fillRect(x - radius * 0.7 + random() * radius * 1.4, y - radius * 0.8 + random() * radius * 0.7, 2.5, 2.5);
        ctx.beginPath();
        ctx.ellipse(x - radius * 0.35, y - radius * 0.62, radius * 0.25, radius * 0.1, -0.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // Lollipop trees.
    for (let y = 40; y < height; y += 210) {
      const side = random() < 0.5 ? -1 : 1;
      const x = side < 0 ? width * (0.1 + random() * 0.12) : width * (0.78 + random() * 0.12);
      const radius = 22 + random() * 10;
      ctx.strokeStyle = '#fff6fb';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y + radius);
      ctx.lineTo(x, y + radius + 54);
      ctx.stroke();
      const colors = [CONFIG.CANDIES[Math.floor(random() * 6)].base, '#ffffff'];
      for (let ring = 6; ring >= 1; ring -= 1) {
        ctx.fillStyle = colors[ring % 2];
        ctx.beginPath();
        ctx.arc(x, y, (radius * ring) / 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.ellipse(x - radius * 0.35, y - radius * 0.45, radius * 0.3, radius * 0.14, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Candy trail: a thick glossy road with candy-cane dashes joining the level nodes.
    const tracePath = () => {
      ctx.beginPath();
      positions.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else {
          const previous = positions[index - 1];
          const middle_y = (previous.y + point.y) / 2;
          ctx.bezierCurveTo(previous.x, middle_y, point.x, middle_y, point.x, point.y);
        }
      });
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    tracePath();
    ctx.strokeStyle = 'rgba(120,30,90,0.25)';
    ctx.lineWidth = 34;
    ctx.stroke();
    tracePath();
    ctx.strokeStyle = '#fff4fa';
    ctx.lineWidth = 28;
    ctx.stroke();
    tracePath();
    ctx.setLineDash([16, 16]);
    ctx.strokeStyle = '#ff7fbf';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  SC.UI = { createUi, ICONS, icon };
})(typeof window !== 'undefined' ? window : globalThis);
