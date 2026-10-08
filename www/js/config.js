// CONFIG: game-wide constants. Rename the game by changing GAME_TITLE (scripts/sync-branding.mjs applies it to Android).
(function attachConfig(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const CONFIG = {
    GAME_TITLE: 'Sweet Cascade',
    VERSION: '1.0.0',

    // Candy set: id -> name, colors and shape (each candy has a distinct color AND shape).
    CANDIES: [
      { id: 0, name: 'Strawberry Heart', shape: 'heart', base: '#ff3b6b', highlight: '#ff9db5', shadow: '#b3123f', warm: '#ff8a7a' },
      { id: 1, name: 'Orange Wedge', shape: 'wedge', base: '#ff9a1f', highlight: '#ffd08a', shadow: '#c4620a', warm: '#ffc04d' },
      { id: 2, name: 'Lemon Drop', shape: 'diamond', base: '#ffe14d', highlight: '#fff7b0', shadow: '#c9a800', warm: '#fff07a' },
      { id: 3, name: 'Mint Cube', shape: 'cube', base: '#3ddc97', highlight: '#a6f5d1', shadow: '#14935c', warm: '#9af0a8' },
      { id: 4, name: 'Blueberry Orb', shape: 'orb', base: '#4aa8ff', highlight: '#b5dcff', shadow: '#1c63b8', warm: '#8fd0ff' },
      { id: 5, name: 'Grape Star', shape: 'star', base: '#a45bff', highlight: '#d6b3ff', shadow: '#5f22b0', warm: '#d48bff' },
    ],

    THEMES: [
      { id: 'gummy', name: 'Gummy' },
      { id: 'hard', name: 'Hard Candy' },
      { id: 'sprinkle', name: 'Sugar Sprinkle' },
    ],

    // Accent palettes recolor the background gradient and buttons.
    ACCENTS: [
      { id: 'bubblegum', name: 'Bubblegum', background: ['#ff9ad5', '#ffd36e', '#8ee3ff'], button: ['#ff6fb5', '#e8418f'], depth: '#a3205f', ink: '#6a1b5a' },
      { id: 'sunset', name: 'Sunset', background: ['#ff7e5f', '#feb47b', '#ffe0a8'], button: ['#ff8a4c', '#e5552a'], depth: '#9c3415', ink: '#6b2410' },
      { id: 'ocean', name: 'Ocean', background: ['#4facfe', '#00d4fe', '#a1ffce'], button: ['#36a3ff', '#1468d8'], depth: '#0c3f8a', ink: '#0d2f66' },
      { id: 'mint', name: 'Mint', background: ['#9ef08a', '#6fe8c8', '#dcfca0'], button: ['#2fd59a', '#139c6c'], depth: '#0b6646', ink: '#0d4f37' },
      { id: 'grape', name: 'Grape', background: ['#c471f5', '#fa71cd', '#f3c8ff'], button: ['#b25cff', '#8130e0'], depth: '#521a99', ink: '#43136e' },
      { id: 'cherry', name: 'Cherry', background: ['#ff5c6c', '#f857a6', '#ffc3a0'], button: ['#ff4f6d', '#d61f45'], depth: '#8c0f2b', ink: '#6e0b22' },
      { id: 'gold', name: 'Gold', background: ['#f6d365', '#fda085', '#fff1a8'], button: ['#ffbf2f', '#e08a00'], depth: '#945a00', ink: '#6b3f00' },
      { id: 'midnight', name: 'Midnight', background: ['#26336e', '#5b2c8f', '#a044ff'], button: ['#7a5cff', '#4b2fcf'], depth: '#24137a', ink: '#1a1046' },
    ],

    CASCADE_BANNERS: { 2: 'Tasty!', 3: 'Sweet!', 4: 'Delicious!', 5: 'Divine!' },
    CASCADE_BANNER_MAX: 'Sugar Rush!',

    TIMING: {
      SWAP_MS: 160,
      INVALID_MS: 300,
      SWELL_MS: 80,
      POP_MS: 220,
      WAVE_GAP_MS: 140,
      FALL_STEP_MS: 105, // time for the first cell of a free fall; later cells are faster (gravity)
      LAND_SQUASH_MS: 140,
      HINT_IDLE_MS: 6000,
      SHIMMER_EVERY_MS: 2600,
      STRIPE_SHIMMER_MS: 3000,
    },

    MAX_PARTICLES: 600,
    MAX_CELL_PX: 76,
    SWIPE_THRESHOLD: 0.35, // fraction of a cell
    FRAME_BUDGET_MS: 24, // adaptive quality kicks in when the average frame time exceeds this for 2 s
  };

  SC.CONFIG = CONFIG;
  SC.GAME_TITLE = CONFIG.GAME_TITLE;
  if (typeof module === 'object' && module.exports) module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
