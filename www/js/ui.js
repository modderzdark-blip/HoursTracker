// UI: DOM screens, HUD, modals, banners, toasts and the accessible live region (the map lives in MAP).
// Every image comes from the SPRITES shader (candies, blockers, hearts, Gold Drops, stars) or from PIP; icons are
// inline SVG. All buttons are real <button> elements with labels.
(function attachUi(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const CONFIG = SC.CONFIG;
  const LOGIC = SC.LOGIC;
  const UTIL = SC.UTIL;
  const SPRITES = SC.SPRITES;
  const META = SC.META;
  const PIP = SC.PIP;

  // ---------------------------------------------------------------- icons (inline SVG, no icon fonts)
  const ICONS = {
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.6" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6" fill="currentColor"/></svg>',
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
    star_empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.1l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.8z" fill="rgba(59,26,74,0.16)" stroke="rgba(59,26,74,0.4)" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.6-7.5 10-7.5 10z" fill="#ff3b6b" stroke="#a3123f" stroke-width="1.4"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.1-5" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M18.5 3.5v4.5H14" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    hammer: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="11" height="6.5" rx="2" fill="#ff6fb5" stroke="#3b1a4a" stroke-width="1.5"/><rect x="10.5" y="9.5" width="3.4" height="11.5" rx="1.5" transform="rotate(-8 12 15)" fill="#ffd36e" stroke="#3b1a4a" stroke-width="1.5"/><path d="M5.5 5.8h4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>',
    swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h12l-3.2-3.2M19 15H7l3.2 3.2" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    whirl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a4 4 0 1 0-8 0a6.5 6.5 0 1 0 13 0a9 9 0 1 0-18 0" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
    wheel: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#ffd36e" stroke="#ffffff" stroke-width="2"/><path d="M12 12L12 2.5A9.5 9.5 0 0 1 21.5 12z" fill="#8ee3ff"/><path d="M12 12L21.5 12A9.5 9.5 0 0 1 12 21.5z" fill="#ff9ad5"/><path d="M12 12L12 21.5A9.5 9.5 0 0 1 2.5 12z" fill="#a6f5d1"/><circle cx="12" cy="12" r="2.8" fill="#ffffff" stroke="#3b1a4a" stroke-width="1.2"/><path d="M12 0.6l2 3.2h-4z" fill="#3b1a4a"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" stroke-width="2.8" fill="none"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>',
  };

  ICONS.crown = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5l4.2 3.6L12 5l4.3 7.1 4.2-3.6-1.6 9.5H5.1z" fill="#ffcf3f" stroke="#a5620a" stroke-width="1.4" stroke-linejoin="round"/><rect x="5" y="18.2" width="14" height="2.6" rx="1.1" fill="#ffb21f" stroke="#a5620a" stroke-width="1.2"/><circle cx="12" cy="13.6" r="1.5" fill="#ff5d8f"/></svg>';
  ICONS.brush = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="10.2" y="2.5" width="3.6" height="10" rx="1.6" fill="#ffd36e" stroke="#3b1a4a" stroke-width="1.4"/><rect x="9.4" y="11.2" width="5.2" height="2.8" rx="0.8" fill="#c9c2d6" stroke="#3b1a4a" stroke-width="1.3"/><path d="M8.6 14h6.8c.4 3.4-.6 6.2-3.4 7.5C9.2 20.2 8.2 17.4 8.6 14z" fill="#ff5d8f" stroke="#3b1a4a" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.6 16.4l4.8-1.2M10 18.8l4-1" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>';
  ICONS.party = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20.5l4.6-12.4 7.8 7.8z" fill="#ffb21f" stroke="#3b1a4a" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 15.2l3.2 3.2M7.4 11.4l5.2 5.2" stroke="#ff5d8f" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="5" r="1.4" fill="#4cc3ff"/><circle cx="20" cy="9.5" r="1.3" fill="#ff5d8f"/><circle cx="12.6" cy="3.6" r="1.1" fill="#7be07b"/><path d="M14.5 9.5c1-2.2 3-3 5-2.6M12.5 7.8c.2-1.4.9-2.5 2-3.2" stroke="#a64dff" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
  ICONS.hand = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17.5 7.5c2.1 0 3.6 1.6 3.6 3.6v13.2l1.4-.3V20c0-2 1.6-3.5 3.5-3.5S29.5 18 29.5 20v3.6l1.2-.2c.3-1.8 1.8-3 3.5-3 2 0 3.5 1.6 3.5 3.6v.6c1.7.2 3 1.6 3 3.4v6.4c0 6.6-5.3 11.6-11.9 11.6h-3.5c-4 0-7.5-1.9-9.8-5.1L9.2 31.7c-1-1.5-.7-3.5.7-4.6 1.4-1.1 3.5-.9 4.6.5l-.5-.6V11.1c0-2 1.5-3.6 3.5-3.6z" fill="#fff" stroke="#3b1a4a" stroke-width="2.4" stroke-linejoin="round"/><path d="M21.1 24.3v6M29.5 23.6v6.4M37.7 24.6v5.6" stroke="#3b1a4a" stroke-width="2" stroke-linecap="round" opacity="0.35"/></svg>';

  function icon(name) {
    return ICONS[name] || '';
  }

  /** Art for an unlock popup or a booster tile: the booster's icon, or the feature's emblem. */
  function unlockArt(id) {
    if (id === 'hammer') return `<span class="unlock-glyph">${ICONS.hammer}</span>`;
    if (id === 'free_swap') return `<span class="unlock-glyph is-ink">${ICONS.swap}</span>`;
    if (id === 'whirl') return `<span class="unlock-glyph is-ink">${ICONS.whirl}</span>`;
    if (id === 'brush') return `<span class="unlock-glyph">${ICONS.brush}</span>`;
    if (id === 'party') return `<span class="unlock-glyph">${ICONS.party}</span>`;
    if (id === 'lucky') return `<img src="${spriteUrl('wrapped:3', 72)}" alt="">`;
    if (id === 'rainbow') return `<img src="${spriteUrl('bomb', 72)}" alt="">`;
    if (id === 'head_start') return '<span class="head-start big">+3</span>';
    if (id === 'wheel') return `<span class="unlock-glyph">${ICONS.wheel}</span>`;
    if (id === 'chest') return `<img src="${SPRITES.iconUrl('star', 144)}" alt="">`;
    if (id === 'streak') return `<span class="streak-art"><img src="${spriteUrl('stripe_row:0', 44)}" alt=""><img src="${spriteUrl('wrapped:4', 44)}" alt=""><img src="${spriteUrl('bomb', 44)}" alt=""></span>`;
    return '';
  }

  /** Small candy icons for a Sweet Streak bag ({striped, wrapped, bomb, moves}). */
  function bagHtml(bag, size) {
    if (!bag) return '';
    let html = '';
    const add = (count, key) => {
      for (let index = 0; index < (count || 0); index += 1) html += `<img src="${spriteUrl(key, size)}" alt="">`;
    };
    add(bag.striped, 'stripe_row:0');
    add(bag.wrapped, 'wrapped:4');
    add(bag.bomb, 'bomb');
    if (bag.moves) html += `<span class="bag-moves">+${bag.moves}</span>`;
    return html;
  }

  function bagText(bag) {
    if (!bag) return '';
    const parts = [];
    if (bag.striped) parts.push(`${bag.striped} striped`);
    if (bag.wrapped) parts.push(`${bag.wrapped} wrapped`);
    if (bag.bomb) parts.push(`${bag.bomb} Rainbow Drop`);
    if (bag.moves) parts.push(`${bag.moves} extra moves`);
    return parts.join(', ');
  }

  // ---------------------------------------------------------------- shaded images for the DOM
  let icon_theme = 'gummy';

  function spriteUrl(key, size) {
    return SPRITES.iconUrl(key, (size || 48) * 2, icon_theme);
  }

  function candyImage(color, special, size) {
    if (special === 'bomb') return spriteUrl('bomb', size);
    if (special && special !== 'none') return spriteUrl(`${special === 'wrapped' ? 'wrapped' : special}:${color}`, size);
    return spriteUrl(`candy:${color}`, size);
  }

  const ORDER_ICONS = { striped: 'stripe_row:4', wrapped: 'wrapped:0', bomb: 'bomb', frosting: 'frosting:2', cocoa: 'cocoa', cage: 'cage', swirl: 'swirl', gift: 'gift' };

  function goalIcon(goal, size) {
    if (goal.type === 'collect') return candyImage(goal.color, 'none', size);
    if (goal.type === 'jelly') return spriteUrl('jelly:2', size);
    if (goal.type === 'ingredients') return spriteUrl('cherry', size);
    if (goal.type === 'order') return spriteUrl(ORDER_ICONS[goal.item] || 'candy:0', size);
    return SPRITES.iconUrl('star', (size || 48) * 2);
  }

  const ORDER_WORDS = {
    striped: (count) => `Fire ${count} striped`,
    wrapped: (count) => `Fire ${count} wrapped`,
    bomb: (count) => `Fire ${count} Color Bomb${count === 1 ? '' : 's'}`,
    frosting: (count) => `Break ${count} frosting layers`,
    cocoa: (count) => `Clear ${count} Cocoa`,
    cage: (count) => `Break ${count} cage${count === 1 ? '' : 's'}`,
    swirl: (count) => `Break ${count} Taffy Swirl${count === 1 ? '' : 's'}`,
    gift: (count) => `Open ${count} Gift Box${count === 1 ? '' : 'es'}`,
  };

  function goalText(goal) {
    if (goal.type === 'score') return `Score ${goal.target.toLocaleString('en-US')}`;
    if (goal.type === 'collect') return `Collect ${goal.count} ${CONFIG.CANDIES[goal.color].name}`;
    if (goal.type === 'jelly') return 'Clear all the jelly';
    if (goal.type === 'ingredients') return `Bring down ${goal.count} ingredient${goal.count === 1 ? '' : 's'}`;
    if (goal.type === 'order') return (ORDER_WORDS[goal.item] || ((count) => `${count} ${goal.item}`))(goal.count);
    return goal.type;
  }

  function element(tag, class_name, attributes) {
    const node = document.createElement(tag);
    if (class_name) node.className = class_name;
    Object.keys(attributes || {}).forEach((key) => {
      if (key === 'text') node.textContent = attributes[key];
      else if (key === 'html') node.innerHTML = attributes[key];
      else node.setAttribute(key, attributes[key]);
    });
    return node;
  }

  function glossyHeading(tag, text, class_name) {
    return element(tag, `glossy-text ${class_name || ''}`.trim(), { 'data-text': text, text });
  }

  function button(text, class_name, on_click, label) {
    const node = element('button', class_name, { type: 'button', text });
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', on_click);
    return node;
  }

  function iconButton(icon_name, label, on_click, class_name) {
    const node = element('button', class_name || 'round', { type: 'button', 'aria-label': label, html: icon(icon_name) });
    node.addEventListener('click', on_click);
    return node;
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /**
   * Star marker positions on the score meter (fractions of its width). Proportional to the thresholds, but the three
   * stars never sit closer than STAR_MARK_GAP to each other (close thresholds would stack the markers into one blob).
   */
  const STAR_MARK_GAP = 0.22;
  function starMarkPositions(stars) {
    const top = stars[2] * 1.1;
    const positions = stars.map((threshold) => threshold / top);
    positions[2] = Math.min(positions[2], 0.94);
    positions[1] = Math.min(positions[1], positions[2] - STAR_MARK_GAP);
    positions[0] = Math.min(positions[0], positions[1] - STAR_MARK_GAP);
    return positions;
  }

  /** Meter fill for a score, piecewise linear through the markers so each star lights exactly when the fill reaches it. */
  function starFillFraction(score, stars, positions) {
    const points = [[0, 0], [stars[0], positions[0]], [stars[1], positions[1]], [stars[2], positions[2]], [stars[2] * 1.1, 1]];
    for (let index = 1; index < points.length; index += 1) {
      const [score_b, at_b] = points[index];
      if (score <= score_b) {
        const [score_a, at_a] = points[index - 1];
        return at_a + ((at_b - at_a) * (score - score_a)) / Math.max(1, score_b - score_a);
      }
    }
    return 1;
  }

  /**
   * Shrinks a modal's ribbon title until it fits beside the close button. Titles never wrap (the glossy overlay is a
   * second copy of the text), and phone fonts run wider than the desktop ones, so the fit is measured, not guessed.
   */
  const CLOSE_BUTTON_ROOM = 56;
  const MIN_TITLE_PX = 18;
  function fitModalTitles(modal) {
    const style = getComputedStyle(modal);
    const content_width = modal.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const available = content_width - (modal.querySelector('.modal-close') ? 2 * CLOSE_BUTTON_ROOM : 0);
    modal.querySelectorAll('.modal-title').forEach((title) => {
      title.style.fontSize = '';
      let size = parseFloat(getComputedStyle(title).fontSize);
      while (title.offsetWidth > available && size > MIN_TITLE_PX) {
        size -= 1;
        title.style.fontSize = `${size}px`;
      }
    });
  }

  function pipImage(expression, size) {
    return element('img', 'pip-image', { src: PIP.pipImageUrl(expression, size), alt: '', width: String(size), height: String(Math.round(size * 1.15)) });
  }

  function createUi(dom, hooks) {
    const modal_handles = [];
    root.addEventListener('resize', () => modal_handles.forEach((handle) => fitModalTitles(handle.node)));
    let toast_timer = null;
    let banner_timer = null;
    let hud_level = null;
    let star_positions = [0.5, 0.7, 0.9];
    let hud_goal_nodes = [];
    let displayed_score = 0;
    let score_target = 0;
    let score_animation = null;
    let tutorial_fade_timer = null;
    let options_keep_tutorial = false;
    let title_pip = null;
    let game_pip = null;
    let game_pip_timer = null;

    document.querySelectorAll('[data-icon]').forEach((node) => {
      node.innerHTML = icon(node.getAttribute('data-icon'));
    });
    const by_id = (id) => document.getElementById(id);

    function clickSound() {
      hooks.sound('tap');
    }

    const ui = {
      icon,
      candyImage,
      goalIcon,
      goalText,
      spriteUrl,
      formatClock,
      showScreen(screen_name) {
        ['title', 'map', 'game'].forEach((name) => dom[`screen_${name}`].classList.toggle('is-active', name === screen_name));
        dom.app.classList.toggle('is-playing', screen_name === 'game');
        dom.app.classList.toggle('is-map', screen_name === 'map');
        if (title_pip) {
          if (screen_name === 'title') title_pip.set('wave');
          else title_pip.stop();
        }
      },
      setIconStyle(theme) {
        icon_theme = SPRITES.THEMES[theme] ? theme : 'gummy';
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
        dom.title_version.textContent = `v${CONFIG.VERSION} · every picture and sound is made by code`;
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
        if (!title_pip && by_id('title-pip')) title_pip = PIP.createPipView(by_id('title-pip'), 96);
        if (title_pip && dom.screen_title.classList.contains('is-active')) title_pip.set('wave');
      },

      // ------------------------------------------------------------ map bar (hearts, Gold Drops, wheel, chest)
      setMapStatus(status) {
        const hearts_chip = by_id('map-hearts');
        by_id('map-hearts-icon').src = SPRITES.iconUrl('heart', 56);
        by_id('map-gold-icon').src = SPRITES.iconUrl('gold', 56);
        by_id('map-chest-icon').src = SPRITES.iconUrl('star', 56);
        if (status.unlimited) {
          by_id('map-hearts-count').textContent = '∞';
          by_id('map-hearts-timer').textContent = '';
          hearts_chip.setAttribute('aria-label', 'Unlimited hearts');
        } else {
          by_id('map-hearts-count').textContent = String(status.hearts);
          by_id('map-hearts-timer').textContent = status.hearts < META.MAX_HEARTS ? formatClock(status.next_heart_ms) : 'Full';
          hearts_chip.setAttribute('aria-label', `${status.hearts} of ${META.MAX_HEARTS} hearts${status.hearts < META.MAX_HEARTS ? `, next in ${formatClock(status.next_heart_ms)}` : ''}`);
        }
        by_id('map-gold-count').textContent = String(status.gold);
        by_id('map-gold').setAttribute('aria-label', `${status.gold} Gold Drops`);
        const wheel = by_id('btn-map-wheel');
        wheel.hidden = !!status.wheel_locked;
        wheel.classList.toggle('is-ready', status.wheel_ready && !status.wheel_locked);
        wheel.setAttribute('aria-label', status.wheel_ready ? 'Daily Wheel: a free spin is ready' : 'Daily Wheel');
        const chest = by_id('btn-map-chest');
        chest.hidden = !!status.chest_locked;
        by_id('map-chest-progress').textContent = `${status.chest_progress}/${META.CHEST_STARS}`;
        chest.classList.toggle('is-ready', status.chest_progress >= META.CHEST_STARS);
        chest.setAttribute('aria-label', `Star Chest: ${status.chest_progress} of ${META.CHEST_STARS} stars`);
      },

      // ------------------------------------------------------------ HUD
      setupHud(level, state) {
        hud_level = level;
        dom.hud_level.textContent = `Level ${level.id}`;
        dom.hud_level.setAttribute('aria-label', `Level ${level.id}, ${level.name}`);
        by_id('hud-moves-label').textContent = state.timed ? 'Time' : 'Moves';
        dom.hud_goal_list.innerHTML = '';
        hud_goal_nodes = level.goals.map((goal) => {
          const node = element('div', 'goal');
          node.appendChild(element('img', 'goal-icon', { src: goalIcon(goal, 30), alt: '' }));
          const count = element('span', 'goal-count');
          node.appendChild(count);
          node.setAttribute('aria-label', goalText(goal));
          dom.hud_goal_list.appendChild(node);
          return { node, count, goal };
        });
        star_positions = starMarkPositions(level.stars);
        level.stars.forEach((threshold, index) => {
          const mark = dom[`star_mark_${index}`];
          mark.style.left = `${star_positions[index] * 100}%`;
          mark.dataset.reached = 'false';
          mark.innerHTML = icon('star_empty');
        });
        displayed_score = state.score;
        score_target = state.score;
        dom.hud_score.textContent = String(state.score);
        ui.updateHud({ moves: state.moves_left, time_left: state.timed ? (state.time_limit + state.time_bonus) * 1000 : undefined, score: state.score, progress: LOGIC.goalProgress(state) }, true);
      },
      updateHud(values, immediate) {
        if (values.time_left !== undefined) {
          dom.hud_moves.textContent = formatClock(values.time_left);
          dom.hud_moves.classList.toggle('is-low', values.time_left <= 10000);
        } else if (values.moves !== undefined && Number.isFinite(values.moves)) {
          dom.hud_moves.textContent = String(values.moves);
          dom.hud_moves.classList.toggle('is-low', values.moves < 5);
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
            if (progress.done && !was_done && !immediate) hooks.sound('goal');
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
          dom.star_fill.style.width = `${starFillFraction(score, hud_level.stars, star_positions) * 100}%`;
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
      /** Booster bar: counts (0 shows a "+" to buy with Gold Drops), the armed booster highlighted. */
      /**
       * locks: { booster: unlock level } for the boosters not unlocked yet (hidden from the bar). Returns true when the
       * bar switched between one row and two (the board then needs a new layout).
       */
      setBoosters(counts, armed, enabled, locks) {
        let visible = 0;
        document.querySelectorAll('.booster').forEach((booster_button) => {
          const name = booster_button.dataset.booster;
          const count = counts[name] || 0;
          const locked_at = locks && locks[name] ? locks[name] : 0;
          const badge = booster_button.querySelector('.booster-count');
          if (locked_at) badge.innerHTML = icon('lock');
          else badge.textContent = count > 0 ? String(count) : '+';
          booster_button.classList.toggle('is-locked', !!locked_at);
          // Like the original, the level's booster bar only shows the boosters unlocked so far.
          booster_button.hidden = !!locked_at;
          if (!locked_at) visible += 1;
          booster_button.classList.toggle('is-empty', !locked_at && count <= 0);
          booster_button.classList.toggle('is-armed', armed === name);
          booster_button.disabled = !enabled;
          booster_button.setAttribute('aria-label', locked_at ? `${META.BOOSTER_NAMES[name]}, unlocks at level ${locked_at}`
            : `${META.BOOSTER_NAMES[name]}, ${count > 0 ? `${count} left` : `buy for ${META.PRICES[name]} Gold Drops`}${armed === name ? ', selected' : ''}`);
        });
        const bar = document.querySelector('.game-bar');
        const many = visible > 3;
        if (!bar || bar.classList.contains('has-many-boosters') === many) return false;
        bar.classList.toggle('has-many-boosters', many);
        return true;
      },
      /**
       * The tap pointer: a hand that taps on `target` (an element, or a {x, y} point in page pixels) with an optional
       * label, used to show a new booster. Passing null hides it.
       */
      pointAt(target, label) {
        let pointer = by_id('tap-pointer');
        if (!target) {
          if (pointer) pointer.classList.remove('is-showing');
          return;
        }
        if (!pointer) {
          pointer = element('div', 'tap-pointer', { id: 'tap-pointer', 'aria-hidden': 'true' });
          pointer.innerHTML = `<span class="tap-ring"></span><span class="tap-hand">${icon('hand')}</span><span class="tap-label"></span>`;
          dom.app.appendChild(pointer);
        }
        let point = target;
        if (target instanceof Element) {
          const rect = target.getBoundingClientRect();
          point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        const app_rect = dom.app.getBoundingClientRect();
        pointer.style.left = `${Math.round(point.x - app_rect.left)}px`;
        pointer.style.top = `${Math.round(point.y - app_rect.top)}px`;
        const label_node = pointer.querySelector('.tap-label');
        label_node.textContent = label || '';
        label_node.hidden = !label;
        // Keep the label on screen: it sits above the hand, shifted toward the middle of the screen.
        const shift = Math.max(-120, Math.min(120, app_rect.width / 2 - (point.x - app_rect.left)));
        label_node.style.transform = `translateX(calc(-50% + ${Math.round(shift)}px))`;
        pointer.classList.toggle('is-low', point.y - app_rect.top > app_rect.height * 0.55);
        pointer.classList.add('is-showing');
      },
      /** Pip in the corner of the game screen: reacts to big combos, points at the hint in the first levels. */
      pip(expression, duration_ms, angle) {
        const canvas = by_id('game-pip');
        if (!canvas) return;
        if (!game_pip) game_pip = PIP.createPipView(canvas, 64);
        clearTimeout(game_pip_timer);
        canvas.classList.add('is-showing');
        game_pip.set(expression, angle);
        if (duration_ms) {
          game_pip_timer = setTimeout(() => {
            canvas.classList.remove('is-showing');
            game_pip.stop();
          }, duration_ms);
        }
      },
      hidePip() {
        clearTimeout(game_pip_timer);
        const canvas = by_id('game-pip');
        if (canvas) canvas.classList.remove('is-showing');
        if (game_pip) game_pip.stop();
      },
      tutorial(text) {
        clearTimeout(tutorial_fade_timer);
        if (!text) {
          dom.tutorial_bubble.hidden = true;
          return;
        }
        dom.tutorial_bubble.textContent = text;
        dom.tutorial_bubble.classList.remove('is-overlay', 'is-faded');
        dom.tutorial_bubble.hidden = false;
      },
      /** Puts the tutorial bubble in free space below or above the board; if there is none, it overlays and fades on touch. */
      placeTutorial(board_rect, has_trays) {
        const bubble = dom.tutorial_bubble;
        if (bubble.hidden || !board_rect) return;
        const bar_top = dom.btn_pause.getBoundingClientRect().top - 4;
        const hud_bottom = by_id('hud').getBoundingClientRect().bottom + 4;
        const height = bubble.offsetHeight;
        const board_bottom = board_rect.top + board_rect.height + (has_trays ? board_rect.cell * 0.35 : 4);
        const board_top = board_rect.top - 4;
        let top;
        if (bar_top - board_bottom >= height) top = board_bottom + (bar_top - board_bottom - height) / 2;
        else if (board_top - hud_bottom >= height) top = hud_bottom + (board_top - hud_bottom - height) / 2;
        else top = board_rect.top + board_rect.height - height - 6;
        bubble.style.top = `${Math.round(top)}px`;
        bubble.style.bottom = 'auto';
        const overlays_board = top < board_bottom && top + height > board_rect.top;
        bubble.classList.toggle('is-overlay', overlays_board);
        clearTimeout(tutorial_fade_timer);
        if (overlays_board && !options_keep_tutorial) tutorial_fade_timer = setTimeout(() => bubble.classList.add('is-faded'), 5000);
      },
      keepTutorial(keep) {
        options_keep_tutorial = keep;
      },
      fadeTutorialOverlay() {
        if (dom.tutorial_bubble.classList.contains('is-overlay')) dom.tutorial_bubble.classList.add('is-faded');
      },

      // ------------------------------------------------------------ banners, toasts, live region
      /**
       * The level-start goal ribbon: a band sweeps across the board with the goals ("Collect the candies!" and each
       * candy with its count), holds, and sweeps out. Returns its length in ms (the game waits for it before play).
       */
      showGoalIntro(goals, options) {
        const ribbon = dom.goal_ribbon;
        if (!ribbon) return 0;
        const types = new Set(goals.map((goal) => goal.type));
        let title = 'Reach every goal!';
        if (types.size === 1) {
          if (types.has('collect')) title = goals.length > 1 ? 'Collect these candies!' : 'Collect the candies!';
          else if (types.has('jelly')) title = 'Clear all the jelly!';
          else if (types.has('ingredients')) title = 'Bring the treats down!';
          else if (types.has('order')) title = 'Complete the order!';
        }
        ribbon.innerHTML = '';
        ribbon.appendChild(element('div', 'goal-ribbon-title glossy-text', { 'data-text': title, text: title }));
        const counted = goals.filter((goal) => goal.type !== 'jelly');
        if (counted.length) {
          const items = element('div', 'goal-ribbon-items');
          counted.forEach((goal) => {
            const item = element('div', 'goal-ribbon-item');
            item.appendChild(element('img', '', { src: goalIcon(goal, 52), alt: '' }));
            item.appendChild(element('span', '', { text: String(goal.count || goal.target || '') }));
            items.appendChild(item);
          });
          ribbon.appendChild(items);
        }
        if (options && options.timed) ribbon.appendChild(element('div', 'goal-ribbon-note', { text: 'before the clock runs out!' }));
        const total_ms = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1500 : 1900;
        ribbon.classList.remove('is-showing');
        void ribbon.offsetWidth;
        ribbon.classList.add('is-showing');
        clearTimeout(ribbon.hide_timer);
        ribbon.hide_timer = setTimeout(() => ribbon.classList.remove('is-showing'), total_ms + 50);
        return total_ms;
      },
      /** A lost heart: the heart pops up over everything, cracks in two and the halves fall away with a "-1". */
      heartBreak() {
        const holder = element('div', 'heart-break', { 'aria-hidden': 'true' });
        const url = SPRITES.iconUrl('heart', 192);
        holder.appendChild(element('img', 'heart-half heart-half-left', { src: url, alt: '' }));
        holder.appendChild(element('img', 'heart-half heart-half-right', { src: url, alt: '' }));
        holder.appendChild(element('div', 'heart-break-count glossy-text', { 'data-text': '-1', text: '-1' }));
        dom.app.appendChild(holder);
        setTimeout(() => holder.remove(), 1600);
      },
      showBanner(text, rainbow, small) {
        clearTimeout(banner_timer);
        dom.banner.innerHTML = '';
        dom.banner.classList.toggle('is-small', !!small);
        dom.banner.appendChild(element('span', `glossy-text${rainbow ? ' rainbow' : ''}`, { 'data-text': text, text }));
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
      /** Opens a modal. `spec`: { id, build(container, handle), back(handle), on_close }. Returns a handle with close(). */
      openModal(spec) {
        dom.modal_root.hidden = false;
        dom.modal_root.classList.remove('is-closing');
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
            if (modal_handles.length === 0) {
              dom.modal_root.classList.add('is-closing');
              setTimeout(() => {
                if (modal_handles.length === 0) dom.modal_root.hidden = true;
              }, 180);
            } else {
              modal_handles[modal_handles.length - 1].node.style.visibility = '';
            }
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
        fitModalTitles(modal);
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
              yes.id = `btn-${options.id || 'confirm'}-yes`;
              row.appendChild(yes);
              modal.appendChild(row);
            },
          });
        });
      },

      /**
       * Level intro: name, role ribbon, goals, moves or time, best stars, pre-level boosters, Pip's tip for a new idea,
       * the Sweet Streak meter. data: { best: {stars, score}, boosters: {lucky, rainbow, head_start}, hearts_on,
       * locks: {booster: unlock level}, try_booster, streak: {on, count, bag, new_level} | null, crown }.
       */
      showIntro(level, data, actions) {
        const chosen = { lucky: false, rainbow: false, head_start: false };
        let pointer_timer = null;
        return ui.openModal({
          id: 'intro',
          back: (handle) => handle.close(),
          on_close: () => {
            clearTimeout(pointer_timer);
            ui.pointAt(null);
            if (actions.closed) actions.closed();
          },
          build(modal, handle) {
            modal.classList.add('intro');
            modal.appendChild(iconButton('close', 'Close', () => {
              clickSound();
              handle.close();
            }, 'round small modal-close'));
            const role = level.role === 'hard' || level.role === 'superhard' ? level.role : null;
            if (role) modal.appendChild(element('div', `role-ribbon is-${role}`, { text: role === 'hard' ? 'Hard level' : 'Super hard level' }));
            modal.appendChild(element('p', 'intro-number', { text: `Level ${level.id}` }));
            modal.appendChild(glossyHeading('h2', level.name, 'modal-title'));
            const stars = element('div', 'star-row');
            for (let index = 0; index < 3; index += 1) stars.insertAdjacentHTML('beforeend', icon(data.best.stars > index ? 'star' : 'star_empty'));
            if (data.crown) stars.insertAdjacentHTML('beforeend', `<span class="intro-crown" title="Won on the first try">${icon('crown')}</span>`);
            modal.appendChild(stars);
            const goals = element('div', 'intro-goals');
            level.goals.forEach((goal) => {
              const goal_card = element('div', 'intro-goal');
              goal_card.appendChild(element('img', '', { src: goalIcon(goal, 46), alt: '' }));
              goal_card.appendChild(element('div', '', { text: goalText(goal) }));
              goals.appendChild(goal_card);
            });
            modal.appendChild(goals);
            const meta = element('div', 'intro-meta');
            meta.appendChild(element('span', '', { html: level.time ? `${icon('clock')} ${level.time} seconds` : `${level.moves} moves` }));
            if (data.best.score) meta.appendChild(element('span', '', { text: `Best ${data.best.score.toLocaleString('en-US')}` }));
            modal.appendChild(meta);
            if (level.tutorial && level.newMechanic) {
              const tip = element('div', 'pip-tip');
              tip.appendChild(pipImage('wow', 56));
              tip.appendChild(element('p', '', { text: level.tutorial }));
              modal.appendChild(tip);
            } else if (level.tip) {
              const tip = element('div', 'pip-tip is-small');
              tip.appendChild(pipImage('wink', 40));
              tip.appendChild(element('p', '', { text: level.tip }));
              modal.appendChild(tip);
            }
            if (data.streak && data.streak.on) {
              const streak = element('div', 'streak-meter');
              let pips = '';
              for (let index = 0; index < META.STREAK_MAX; index += 1) pips += `<i class="${index < data.streak.count ? 'is-on' : ''}"></i>`;
              streak.innerHTML = `<div class="streak-head"><strong>Sweet Streak</strong><span class="streak-pips" aria-hidden="true">${pips}</span></div>`;
              let line;
              if (!data.streak.new_level) line = 'Replays do not change your streak.';
              else if (data.streak.bag) line = `<span>Starts with:</span><span class="bag">${bagHtml(data.streak.bag, 26)}</span>`;
              else line = 'Win on the first try to start a streak!';
              streak.appendChild(element('div', 'streak-line', { html: line }));
              streak.setAttribute('aria-label', `Sweet Streak ${data.streak.count}${data.streak.bag && data.streak.new_level ? `: this level starts with ${bagText(data.streak.bag)}` : ''}`);
              modal.appendChild(streak);
            }
            const booster_row = element('div', 'intro-boosters', { role: 'group', 'aria-label': 'Pre-level boosters' });
            [['lucky', 'wrapped:3', 'Lucky Start'], ['rainbow', 'bomb', 'Rainbow Start'], ['head_start', null, level.time ? '+10 seconds' : '+3 moves']].forEach(([name, sprite_key, label]) => {
              const count = data.boosters[name] || 0;
              const locked_at = data.locks && data.locks[name] ? data.locks[name] : 0;
              const toggle = element('button', `intro-booster${locked_at ? ' is-locked' : count ? '' : ' is-empty'}`, { type: 'button', role: 'switch', 'aria-checked': 'false', id: `intro-booster-${name}` });
              toggle.innerHTML = `${sprite_key ? `<img src="${spriteUrl(sprite_key, 40)}" alt="">` : `<span class="head-start">${level.time ? '+10s' : '+3'}</span>`}<small>${locked_at ? `Level ${locked_at}` : label}</small><b>${locked_at ? icon('lock') : count || '+'}</b>`;
              toggle.setAttribute('aria-label', locked_at ? `${META.BOOSTER_NAMES[name]}, unlocks at level ${locked_at}`
                : `${META.BOOSTER_NAMES[name]}, ${count ? `${count} owned` : `buy for ${META.PRICES[name]} Gold Drops`}`);
              if (data.try_booster === name && !locked_at) {
                pointer_timer = setTimeout(() => ui.pointAt(toggle, `Tap to use your free ${META.BOOSTER_NAMES[name]}!`), 450);
              }
              toggle.addEventListener('click', () => {
                clickSound();
                if (data.try_booster === name) ui.pointAt(null);
                if (locked_at) {
                  ui.toast(`${META.BOOSTER_NAMES[name]} unlocks at level ${locked_at}`);
                  return;
                }
                if (!(data.boosters[name] > 0)) {
                  actions.buy(name).then((bought) => {
                    if (!bought) return;
                    data.boosters[name] = (data.boosters[name] || 0) + 1;
                    toggle.classList.remove('is-empty');
                    toggle.querySelector('b').textContent = String(data.boosters[name]);
                  });
                  return;
                }
                chosen[name] = !chosen[name];
                toggle.setAttribute('aria-checked', String(chosen[name]));
                toggle.classList.toggle('is-on', chosen[name]);
              });
              booster_row.appendChild(toggle);
            });
            modal.appendChild(booster_row);
            const column = element('div', 'button-column');
            const play = button(data.hearts_on ? 'Play' : 'Play', 'pill pill-big', () => {
              clickSound();
              handle.close();
              actions.play(Object.assign({}, chosen));
            });
            if (data.hearts_on) play.innerHTML = `Play <span class="play-cost">${icon('heart')}1</span>`;
            play.setAttribute('aria-label', 'Play');
            play.setAttribute('data-autofocus', '');
            play.id = 'btn-intro-play';
            column.appendChild(play);
            modal.appendChild(column);
          },
        });
      },

      /** A booster or feature just unlocked (META.UNLOCKS entry). Resolves when closed. */
      showUnlock(unlock) {
        return new Promise((resolve) => {
          ui.openModal({
            id: 'unlock',
            back: (handle) => handle.close(),
            on_close: () => resolve(),
            build(modal, handle) {
              modal.classList.add('unlock');
              modal.appendChild(element('p', 'unlock-kicker', { text: unlock.kind === 'booster' ? 'New booster!' : 'New feature!' }));
              const art = element('div', 'unlock-art', { html: `<span class="unlock-rays" aria-hidden="true"></span>${unlockArt(unlock.id)}` });
              modal.appendChild(art);
              modal.appendChild(glossyHeading('h2', unlock.title, 'modal-title'));
              modal.appendChild(element('p', 'unlock-text', { text: unlock.text }));
              if (unlock.gift) modal.appendChild(element('div', 'reward-row', { html: `<span class="reward">${unlock.gift} free!</span>` }));
              const ok = button(unlock.kind === 'booster' ? 'Great!' : 'Got it!', 'pill pill-big', () => {
                clickSound();
                handle.close();
              });
              ok.id = 'btn-unlock-ok';
              ok.setAttribute('data-autofocus', '');
              const column = element('div', 'button-column');
              column.appendChild(ok);
              modal.appendChild(column);
              hooks.sound('reward');
            },
          });
        });
      },

      /**
       * Episode finale cleared for the first time. data: { episode, name, stars, max_stars, crowns, levels, reward:
       * {gold, booster}, next: {episode, name} | null }. Resolves when closed.
       */
      showEpisodeComplete(data) {
        return new Promise((resolve) => {
          ui.openModal({
            id: 'episode',
            back: (handle) => handle.close(),
            on_close: () => resolve(),
            build(modal, handle) {
              modal.classList.add('episode-done');
              modal.appendChild(element('div', 'unlock-art', { html: `<span class="unlock-rays" aria-hidden="true"></span>${pipImage('cheer', 84).outerHTML}` }));
              modal.appendChild(element('p', 'unlock-kicker', { text: `Episode ${data.episode} complete!` }));
              modal.appendChild(glossyHeading('h2', data.name, 'modal-title'));
              const tally = element('div', 'episode-tally');
              tally.appendChild(element('span', '', { html: `${icon('star')}<b>${data.stars}</b>/${data.max_stars}` }));
              tally.appendChild(element('span', '', { html: `${icon('crown')}<b>${data.crowns}</b>/${data.levels}` }));
              modal.appendChild(tally);
              const rewards = element('div', 'reward-row');
              rewards.appendChild(element('span', 'reward', { html: `<img src="${SPRITES.iconUrl('gold', 48)}" alt="">+${data.reward.gold}` }));
              if (data.reward.booster) rewards.appendChild(element('span', 'reward', { text: `+1 ${META.BOOSTER_NAMES[data.reward.booster]}` }));
              modal.appendChild(rewards);
              if (data.next) modal.appendChild(element('p', 'episode-next', { text: `Next: Episode ${data.next.episode}, ${data.next.name}` }));
              const ok = button('Continue', 'pill pill-big', () => {
                clickSound();
                handle.close();
              });
              ok.id = 'btn-episode-continue';
              ok.setAttribute('data-autofocus', '');
              const column = element('div', 'button-column');
              column.appendChild(ok);
              modal.appendChild(column);
              hooks.sound('win');
              hooks.haptic('heavy');
            },
          });
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

      /**
       * data: { score, stars, is_new_best, player_name, win_message, has_next, crown, rewards: {gold, chest_ready},
       * streak: the Sweet Streak after this win (0 = none shown), streak_on }
       */
      showWin(data, actions) {
        const timers = [];
        let count_frame = 0;
        return ui.openModal({
          id: 'win',
          back: () => actions.map(),
          on_close: () => {
            timers.forEach((timer) => clearTimeout(timer));
            cancelAnimationFrame(count_frame);
          },
          build(modal) {
            modal.classList.add('win');
            modal.appendChild(pipImage('cheer', 70));
            modal.appendChild(glossyHeading('h2', 'Sweet Victory!', 'modal-title'));
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
            const rewards = element('div', 'reward-row');
            if (data.rewards.gold) rewards.appendChild(element('span', 'reward', { html: `<img src="${SPRITES.iconUrl('gold', 48)}" alt="">+${data.rewards.gold}` }));
            if (data.crown) rewards.appendChild(element('span', 'reward is-crown', { html: `${icon('crown')}First try!` }));
            if (data.streak_on && data.streak > 0) rewards.appendChild(element('span', 'reward is-streak', { html: `Sweet Streak ${data.streak}! <span class="bag">${bagHtml(META.streakBag(data.streak), 20)}</span>` }));
            if (data.rewards.chest_ready) rewards.appendChild(element('span', 'reward', { text: 'Star Chest ready!' }));
            modal.appendChild(rewards);
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
            const start = performance.now();
            const count_up = (time) => {
              const progress = Math.min(1, (time - start) / 700);
              score_line.textContent = Math.round(data.score * UTIL.EASE.outCubic(progress)).toLocaleString('en-US');
              if (progress < 1) count_frame = requestAnimationFrame(count_up);
            };
            count_frame = requestAnimationFrame(count_up);
            slots.forEach((slot, index) => {
              if (index >= data.stars) return;
              timers.push(setTimeout(() => {
                slot.innerHTML = icon('star');
                slot.classList.add('is-popping');
                hooks.sound('star', { index });
                hooks.haptic('medium');
              }, 450 + index * 380));
            });
            timers.push(setTimeout(() => {
              best.hidden = !data.is_new_best;
            }, 450 + data.stars * 380));
          },
        });
      },

      /** data: { progress, goals, player_name, reason, can_continue, price, gold } */
      showLose(data, actions) {
        return ui.openModal({
          id: 'lose',
          back: () => actions.map(),
          build(modal) {
            modal.classList.add('lose');
            modal.appendChild(pipImage('worried', 64));
            const titles = { moves: 'Out of moves!', time: "Time's up!", fuse: 'The fuse went off!', no_moves: 'No more moves!' };
            modal.appendChild(glossyHeading('h2', titles[data.reason] || 'So close!', 'modal-title'));
            modal.appendChild(element('p', '', { text: `${data.player_name ? `So close, ${data.player_name}! ` : 'So close! '}Still to go:` }));
            const summary = element('div', 'intro-goals goal-summary');
            data.progress.forEach((progress, index) => {
              if (progress.done) return;
              const goal = data.goals[index];
              const card = element('div', 'intro-goal');
              card.appendChild(element('img', '', { src: goalIcon(goal, 46), alt: '' }));
              let text;
              if (progress.type === 'score') text = `${(progress.target - progress.current).toLocaleString('en-US')} points`;
              else if (progress.type === 'jelly') text = `${progress.remaining_cells} jelly`;
              else text = `${progress.target - progress.current} left`;
              card.appendChild(element('div', '', { text }));
              summary.appendChild(card);
            });
            modal.appendChild(summary);
            if (data.streak_at_risk > 0) {
              modal.appendChild(element('p', 'streak-warning', { html: `<span>Giving up ends your <b>Sweet Streak of ${data.streak_at_risk}</b>!</span>` }));
            } else {
              modal.appendChild(element('p', 'pip-says', { text: 'Pip says: every try teaches the board a little better. You can do it!' }));
            }
            const column = element('div', 'button-column');
            if (data.can_continue) {
              const plus = button('', 'pill pill-big gold', () => {
                clickSound();
                actions.plusFive();
              });
              plus.innerHTML = `${data.timed ? '+15 seconds' : '+5 Moves'} <span class="price"><img src="${SPRITES.iconUrl('gold', 40)}" alt="">${data.price}</span>`;
              plus.setAttribute('aria-label', `${data.timed ? 'Add 15 seconds' : 'Add 5 moves'} for ${data.price} Gold Drops (you have ${data.gold})`);
              plus.id = 'btn-plus-five';
              plus.disabled = data.gold < data.price;
              column.appendChild(plus);
            }
            const retry = button('Try again', data.can_continue ? 'pill' : 'pill pill-big', () => {
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

      /** Out of hearts: a countdown to the next heart, Pip, and a shortcut to the Unlimited hearts setting. */
      showHeartsEmpty(data, actions) {
        let timer = null;
        return ui.openModal({
          id: 'hearts',
          back: (handle) => handle.close(),
          on_close: () => clearInterval(timer),
          build(modal, handle) {
            modal.appendChild(pipImage('worried', 64));
            modal.appendChild(glossyHeading('h2', 'Out of hearts', 'modal-title'));
            const line = element('p', 'hearts-countdown', { text: '' });
            line.id = 'hearts-countdown';
            const update = () => {
              const ms = data.nextHeartMs();
              line.textContent = ms > 0 ? `Next heart in ${formatClock(ms)}` : 'A heart is ready!';
              if (ms <= 0) clearInterval(timer);
            };
            update();
            timer = setInterval(update, 1000);
            modal.appendChild(line);
            modal.appendChild(element('p', '', { text: 'Hearts refill by themselves, one every 30 minutes. Prefer to play without them? Turn on Unlimited hearts.' }));
            const column = element('div', 'button-column');
            const settings_button = button('Unlimited hearts', 'pill', () => {
              clickSound();
              handle.close();
              actions.unlimited();
            });
            settings_button.id = 'btn-hearts-unlimited';
            column.appendChild(settings_button);
            column.appendChild(button('OK', 'pill secondary', () => {
              clickSound();
              handle.close();
            }));
            modal.appendChild(column);
          },
        });
      },

      /** Daily Wheel: eight prizes, one spin per local day. actions.spin() returns {index, reward} or null. */
      showWheel(data, actions) {
        return ui.openModal({
          id: 'wheel',
          back: (handle) => handle.close(),
          build(modal, handle) {
            modal.classList.add('wheel-modal');
            modal.appendChild(iconButton('close', 'Close', () => {
              clickSound();
              handle.close();
            }, 'round small modal-close'));
            modal.appendChild(glossyHeading('h2', 'Daily Wheel', 'modal-title'));
            const size = 240;
            const canvas = element('canvas', 'wheel-canvas', { width: String(size * 2), height: String(size * 2), 'aria-hidden': 'true' });
            canvas.style.width = `${size}px`;
            canvas.style.height = `${size}px`;
            const ctx = canvas.getContext('2d');
            const segments = META.WHEEL;
            const colors = ['#ff9ad5', '#ffd36e', '#8ee3ff', '#a6f5d1', '#ffb3c8', '#d6b3ff', '#fff2b0', '#b5dcff'];
            const drawWheel = (rotation) => {
              ctx.setTransform(2, 0, 0, 2, 0, 0);
              ctx.clearRect(0, 0, size, size);
              const center = size / 2;
              const radius = size / 2 - 8;
              segments.forEach((segment, index) => {
                const start = rotation + (index / segments.length) * Math.PI * 2 - Math.PI / 2;
                const end = start + (Math.PI * 2) / segments.length;
                ctx.fillStyle = colors[index % colors.length];
                ctx.beginPath();
                ctx.moveTo(center, center);
                ctx.arc(center, center, radius, start, end);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.save();
                ctx.translate(center, center);
                // Labels on the left half of the wheel (at rest) are turned half a circle so none of them read upside down.
                const flipped = Math.cos(((index + 0.5) / segments.length) * Math.PI * 2 - Math.PI / 2) < -0.01;
                ctx.rotate((start + end) / 2 + (flipped ? Math.PI : 0));
                ctx.fillStyle = '#3b1a4a';
                ctx.font = '800 11px system-ui, Roboto, sans-serif';
                ctx.textAlign = flipped ? 'left' : 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(segment.kind === 'gold' ? `${segment.amount} drops` : segment.kind === 'heart' ? '1 heart' : segment.label, flipped ? -(radius - 10) : radius - 10, 0);
                ctx.restore();
              });
              ctx.strokeStyle = '#3b1a4a';
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.arc(center, center, radius, 0, Math.PI * 2);
              ctx.stroke();
              const hub = ctx.createRadialGradient(center - 6, center - 6, 2, center, center, 22);
              hub.addColorStop(0, '#fff6d6');
              hub.addColorStop(1, '#ff6fb5');
              ctx.fillStyle = hub;
              ctx.beginPath();
              ctx.arc(center, center, 20, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#3b1a4a';
              ctx.beginPath();
              ctx.moveTo(center - 12, 2);
              ctx.lineTo(center + 12, 2);
              ctx.lineTo(center, 26);
              ctx.closePath();
              ctx.fill();
            };
            drawWheel(0);
            modal.appendChild(canvas);
            const result = element('p', 'wheel-result', { text: data.can_spin ? 'One free spin every day!' : 'Come back tomorrow for another spin.' });
            modal.appendChild(result);
            const spin = button('Spin!', 'pill pill-big', () => {
              clickSound();
              spin.disabled = true;
              const outcome = actions.spin();
              if (!outcome) {
                result.textContent = 'Come back tomorrow for another spin.';
                return;
              }
              const turns = 5;
              const slice = (Math.PI * 2) / segments.length;
              const final_rotation = Math.PI * 2 * turns - (outcome.index + 0.5) * slice;
              const begin = performance.now();
              const duration = dom.app.classList.contains('reduced-motion') ? 1 : 3200;
              hooks.sound('wheel');
              const animate = (time) => {
                if (!canvas.isConnected) return;
                const progress = Math.min(1, (time - begin) / duration);
                drawWheel(final_rotation * UTIL.EASE.outCubic(progress));
                if (progress < 1) requestAnimationFrame(animate);
                else {
                  result.textContent = `You won ${outcome.reward.label}!`;
                  hooks.sound('reward');
                  hooks.haptic('medium');
                  actions.done();
                }
              };
              requestAnimationFrame(animate);
            });
            spin.id = 'btn-wheel-spin';
            spin.disabled = !data.can_spin;
            modal.appendChild(spin);
          },
        });
      },

      showReward(title, text, expression) {
        hooks.sound('reward');
        return ui.openModal({
          id: 'reward',
          back: (handle) => handle.close(),
          build(modal, handle) {
            modal.appendChild(pipImage(expression || 'cheer', 64));
            modal.appendChild(glossyHeading('h2', title, 'modal-title'));
            modal.appendChild(element('p', 'reward-text', { text }));
            const ok = button('Yay!', 'pill', () => {
              clickSound();
              handle.close();
            });
            ok.id = 'btn-reward-ok';
            ok.setAttribute('data-autofocus', '');
            modal.appendChild(ok);
          },
        });
      },

      /** Buy a booster (or +5 Moves) with Gold Drops. Resolves true when bought. */
      confirmBuy(item, gold) {
        const price = META.PRICES[item];
        if (gold < price) {
          ui.toast(`You need ${price} Gold Drops (you have ${gold}). Win levels and spin the Daily Wheel for more!`);
          return Promise.resolve(false);
        }
        return ui.confirm({ id: 'confirm-buy', title: `Get ${META.BOOSTER_NAMES[item] || '+5 Moves'}?`, text: `${price} Gold Drops (you have ${gold}).`, yes: 'Buy', no: 'Not now' });
      },

      showGoTo(max_level, actions) {
        return ui.openModal({
          id: 'goto',
          back: (handle) => handle.close(),
          build(modal, handle) {
            modal.appendChild(glossyHeading('h2', 'Go to level', 'modal-title'));
            const input = element('input', 'text-input', { type: 'number', inputmode: 'numeric', min: '1', max: String(max_level), placeholder: `1 - ${max_level}`, 'aria-label': 'Level number', id: 'goto-input' });
            modal.appendChild(input);
            const row = element('div', 'button-row');
            row.appendChild(button('Cancel', 'pill secondary', () => {
              clickSound();
              handle.close();
            }));
            const go = button('Go', 'pill', () => {
              clickSound();
              const value = parseInt(input.value, 10);
              if (!(value >= 1 && value <= max_level)) {
                ui.toast(`Pick a level from 1 to ${max_level}`);
                return;
              }
              handle.close();
              actions.go(value);
            });
            go.id = 'btn-goto-go';
            row.appendChild(go);
            modal.appendChild(row);
            input.addEventListener('keydown', (event) => {
              if (event.key === 'Enter') go.click();
            });
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
            modal.appendChild(pipImage('wave', 64));
            modal.appendChild(glossyHeading('h2', 'Hello there!', 'modal-title'));
            modal.appendChild(element('p', '', { text: "I'm Pip! What should I call you?" }));
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

      /** First launch: "Volume check: is this volume comfortable?" with a slider and a gentle sample. */
      showComfort(settings, actions) {
        return ui.openModal({
          id: 'comfort',
          back: (handle) => {
            handle.close();
            actions.done();
          },
          build(modal, handle) {
            modal.appendChild(glossyHeading('h2', 'Volume check', 'modal-title'));
            modal.appendChild(element('p', '', { text: 'Is this volume comfortable? All sounds are soft by design. Move the slider until the sample feels gentle.' }));
            const slider = element('input', 'comfort-slider', { type: 'range', min: '0', max: '1', step: '0.05', value: String(settings.master_volume), id: 'comfort-slider', 'aria-label': 'Overall volume' });
            slider.addEventListener('input', () => actions.change('master_volume', parseFloat(slider.value)));
            slider.addEventListener('change', () => actions.soundCheck());
            modal.appendChild(slider);
            const row = element('div', 'button-row');
            row.appendChild(button('Play sample', 'pill secondary', () => actions.soundCheck()));
            const ok = button('Sounds good', 'pill', () => {
              clickSound();
              handle.close();
              actions.done();
            });
            ok.id = 'btn-comfort-ok';
            row.appendChild(ok);
            modal.appendChild(row);
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
            modal.appendChild(glossyHeading('h2', 'Settings', 'modal-title'));
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
            const choiceRow = (label, key, value, options) => {
              const row = element('div', 'setting-row is-choice');
              row.appendChild(element('span', 'setting-label', { text: label }));
              const group = element('div', 'segmented', { role: 'radiogroup', 'aria-label': label });
              options.forEach(([option_value, option_label]) => {
                const option = element('button', 'segment', { type: 'button', role: 'radio', 'aria-checked': String(value === option_value), id: `choice-${key}-${option_value}`, text: option_label });
                option.addEventListener('click', () => {
                  group.querySelectorAll('.segment').forEach((other) => other.setAttribute('aria-checked', String(other === option)));
                  actions.change(key, option_value);
                  clickSound();
                });
                group.appendChild(option);
              });
              row.appendChild(group);
              modal.appendChild(row);
            };
            section('Sound');
            toggleRow('Sound effects', 'sound_on', settings.sound_on);
            toggleRow('Music', 'music_on', settings.music_on);
            sliderRow('Overall volume', 'master_volume', settings.master_volume);
            sliderRow('Effects volume', 'effects_volume', settings.effects_volume);
            sliderRow('Music volume', 'music_volume', settings.music_volume);
            toggleRow('Soft Sounds (extra gentle)', 'soft_sounds', settings.soft_sounds);
            const check = button('Sound Check', 'pill secondary', () => actions.soundCheck());
            check.id = 'btn-sound-check';
            modal.appendChild(check);
            section('Play');
            choiceRow('Auto hint', 'auto_hint', settings.auto_hint, [['instant', 'Instant'], ['3s', '3 s'], ['8s', '8 s'], ['off', 'Off']]);
            choiceRow('Animation speed', 'animation_speed', settings.animation_speed, [['normal', 'Normal'], ['snappy', 'Snappy'], ['fast', 'Fast']]);
            toggleRow('Unlimited hearts', 'unlimited_hearts', settings.unlimited_hearts);
            toggleRow('Haptics (vibration)', 'haptics', settings.haptics);
            toggleRow('Reduced motion', 'reduced_motion', settings.reduced_motion);
            toggleRow('Color-blind assist', 'colorblind', settings.colorblind);
            section('Candy material');
            const themes = element('div', 'choice-grid', { role: 'radiogroup', 'aria-label': 'Candy material' });
            CONFIG.THEMES.forEach((theme) => {
              const choice = element('button', 'choice', { type: 'button', role: 'radio', 'aria-checked': String(settings.theme === theme.id), 'aria-label': theme.name, 'data-theme': theme.id });
              choice.innerHTML = `<img src="${SPRITES.iconUrl('candy:0', 80, theme.id)}" alt=""><span>${theme.name}</span>`;
              choice.addEventListener('click', () => {
                themes.querySelectorAll('.choice').forEach((other) => other.setAttribute('aria-checked', String(other === choice)));
                actions.change('theme', theme.id);
                clickSound();
              });
              themes.appendChild(choice);
            });
            modal.appendChild(themes);
            section('Colors');
            const swatches = element('div', 'swatch-grid', { role: 'radiogroup', 'aria-label': 'Accent palette' });
            CONFIG.ACCENTS.forEach((accent) => {
              const swatch = element('button', 'swatch', { type: 'button', role: 'radio', 'aria-checked': String(settings.accent === accent.id), 'aria-label': accent.name, 'data-accent': accent.id });
              swatch.style.background = `linear-gradient(135deg, ${accent.background[0]}, ${accent.background[1]} 55%, ${accent.background[2]})`;
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
            const stackRow = (label, control) => {
              const row = element('div', 'setting-row is-stacked');
              row.appendChild(element('label', '', { text: label, for: control.id }));
              row.appendChild(control);
              modal.appendChild(row);
            };
            const name_input = element('input', 'text-input', { type: 'text', maxlength: '16', value: player.name || '', id: 'settings-name', placeholder: 'Your name', autocomplete: 'off' });
            name_input.addEventListener('change', () => actions.change('player_name', name_input.value));
            stackRow('Player name', name_input);
            const photo_row = element('div', 'setting-row is-stacked');
            photo_row.appendChild(element('label', '', { text: 'Background photo (stays on this phone)' }));
            const preview = element('div', 'photo-preview', { text: player.photo ? '' : 'No photo yet' });
            if (player.photo) preview.style.backgroundImage = `url("${player.photo}")`;
            photo_row.appendChild(preview);
            const photo_buttons = element('div', 'button-row');
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
            const message_input = element('input', 'text-input', { type: 'text', maxlength: '80', value: settings.win_message || '', id: 'settings-message', placeholder: 'e.g. You are amazing!', autocomplete: 'off' });
            message_input.addEventListener('change', () => actions.change('win_message', message_input.value));
            stackRow('Level-complete message (optional)', message_input);
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
            const table = (rows) => {
              const node = element('table', 'help-table');
              rows.forEach(([left, right]) => node.insertAdjacentHTML('beforeend', `<tr><td>${left}</td><td>${right}</td></tr>`));
              modal.appendChild(node);
            };
            modal.appendChild(element('h3', '', { text: 'Basics' }));
            row(candyImage(0, 'none', 48), 'Swap two neighboring candies (tap one, then the other, or swipe) to line up <b>3 or more</b> of the same kind. Meet every goal before your moves (or the clock) run out.');
            row(candyImage(4, 'none', 48), 'Every candy has its own color <b>and</b> shape. Turn on <b>Color-blind assist</b> in Settings for white symbols too.');
            row(SPRITES.iconUrl('star', 96), 'The light bulb shows the best move at once. Auto hint (Settings) can show it by itself: Instant, after 3 s, after 8 s, or Off.');
            modal.appendChild(element('h3', '', { text: 'Special candies' }));
            row(candyImage(3, 'stripe_col', 48), '<b>Match 4 in a line</b>: Striped candy. It clears its whole row or column.');
            row(candyImage(5, 'wrapped', 48), '<b>Match an L, T or +</b>: Wrapped candy. Explodes 3×3, then again after the board settles.');
            row(candyImage(0, 'bomb', 48), '<b>Match 5 in a line</b>: Color Bomb. Swap it with a candy to clear every candy of that color.');
            modal.appendChild(element('h3', '', { text: 'Combos (swap two specials)' }));
            table([
              ['Striped + Striped', 'Row and column cross'],
              ['Striped + Wrapped', '3 rows and 3 columns'],
              ['Wrapped + Wrapped', '5×5 blast, twice'],
              ['Bomb + Striped', 'That color turns striped and fires'],
              ['Bomb + Wrapped', 'That color turns wrapped and explodes'],
              ['Bomb + Bomb', 'Clears the whole board'],
            ]);
            modal.appendChild(element('h3', '', { text: 'Board pieces' }));
            row(spriteUrl('jelly:2', 48), '<b>Jelly</b> sits under candies. Match on top of it to wipe it away (thick jelly needs two).');
            row(spriteUrl('frosting:3', 48), '<b>Frosting</b> (1 to 5 layers) blocks a cell. Match next to it or blast it to crack a layer.');
            row(spriteUrl('cage', 48), '<b>Sugar Cage</b>: the candy inside cannot move. Match it or blast it to break the cage.');
            row(spriteUrl('cocoa', 48), '<b>Cocoa Creep</b> spreads after a move that clears none of it. Match beside it to clean it up.');
            row(candyImage(2, 'none', 48), '<b>Fuse Candy</b> shows a countdown. Clear it before it reaches zero!');
            row(spriteUrl('swirl', 48), '<b>Taffy Swirl</b> falls like a candy but never matches. Match beside it or blast it to break it. It stops a striped beam.');
            row(spriteUrl('gift', 48), '<b>Gift Box</b> falls like a candy. Match beside it or blast it to open it: a special candy is inside!');
            row(spriteUrl('cherry', 48), '<b>Ingredients</b> (cherries and hazelnuts): bring them down to the trays. Blasts never break them.');
            row(spriteUrl('candy:4', 48), '<b>Portals</b> pass falling candies to their partner. <b>Sugar Belts</b> slide candies one step after every move.');
            modal.appendChild(element('h3', '', { text: 'Boosters and hearts' }));
            table([
              ['Sweet Hammer', 'Smash one piece or one blocker layer'],
              ['Free Swap', 'Swap any two neighbors, no move used'],
              ['Candy Whirl', 'Shuffle the candies'],
              ['Candy Brush', 'Paint a candy into a striped candy'],
              ['Sugar Party', 'One blast over the whole board'],
              ['Lucky / Rainbow / Head Start', 'Begin with specials, a Color Bomb, or +3 moves'],
              ['Hearts', 'A loss costs one; one refills every 30 minutes (or turn on Unlimited hearts)'],
              ['Gold Drops', 'Earned from wins, stars, the Daily Wheel and Star Chests'],
            ]);
            modal.appendChild(element('h3', '', { text: 'Scoring' }));
            const points = LOGIC.SCORING;
            table([
              ['Match of 3 / 4 / 5 / 6', `${LOGIC.matchPoints(3)} / ${LOGIC.matchPoints(4)} / ${LOGIC.matchPoints(5)} / ${LOGIC.matchPoints(6)}`],
              ['Make striped / wrapped / bomb', `${points.CREATE_STRIPE} / ${points.CREATE_WRAPPED} / ${points.CREATE_BOMB}`],
              ['Each candy cleared by a special', String(points.ACTIVATION_PER_CANDY)],
              ['Each special set off', String(points.ACTIVATION_PER_SPECIAL)],
              ['Cascades', '×1, ×1.5, ×2, ×2.5 … up to ×4'],
              ['Ingredient delivered', String(points.INGREDIENT)],
              ['Jelly layer / frosting layer', `${points.JELLY_LAYER} / ${points.FROSTING_LAYER}`],
              ['Sweet Finale: each move left', `${points.END_BONUS_PER_MOVE} + a striped candy that fires`],
            ]);
            modal.appendChild(element('p', 'help-footer', { text: 'No moves left? The board reshuffles by itself. New levels are data: the "Levels" workflow generates and calibrates them into level packs.' }));
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

  SC.UI = { createUi, icon };
})(typeof window !== 'undefined' ? window : globalThis);
