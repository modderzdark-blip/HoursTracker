// CONFIG: game-wide constants. Rename the game by changing GAME_TITLE (scripts/sync-branding.mjs applies it to Android).
(function attachConfig(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const CONFIG = {
    GAME_TITLE: 'Sweet Cascade',
    VERSION: '1.5.0',

    // Candy set: the classic candy-shop six, each with a distinct color AND shape. SPRITES shades them (same table there).
    CANDIES: [
      { id: 0, name: 'Cherry Bean', shape: 'bean', base: '#ff2e4f', highlight: '#ff9aa8', shadow: '#a80d2c' },
      { id: 1, name: 'Orange Lozenge', shape: 'lozenge', base: '#ff8a12', highlight: '#ffc77a', shadow: '#c25300' },
      { id: 2, name: 'Lemon Drop', shape: 'lemon', base: '#ffd92e', highlight: '#fff6a8', shadow: '#c49a00' },
      { id: 3, name: 'Mint Square', shape: 'chiclet', base: '#2fd36b', highlight: '#a3f5bd', shadow: '#0f8a3c' },
      { id: 4, name: 'Blueberry Ball', shape: 'ball', base: '#2f8cff', highlight: '#a8d4ff', shadow: '#1450b8' },
      { id: 5, name: 'Grape Cluster', shape: 'cluster', base: '#a64dff', highlight: '#dcb5ff', shadow: '#5a1aa8' },
    ],

    THEMES: [
      { id: 'gummy', name: 'Gummy' },
      { id: 'hard', name: 'Hard Candy' },
      { id: 'sprinkle', name: 'Sugar Sprinkle' },
    ],

    // Accent palettes recolor the default backdrop and the UI accents. Bubblegum is the default (#ff9ad5 -> #ffd36e -> #8ee3ff).
    ACCENTS: [
      { id: 'bubblegum', name: 'Bubblegum', background: ['#ff9ad5', '#ffd36e', '#8ee3ff'], button: ['#ff6fb5', '#e0388e'], depth: '#a3205f', ink: '#3b1a4a' },
      { id: 'sunset', name: 'Sunset', background: ['#ff7e5f', '#feb47b', '#ffe0a8'], button: ['#ff8a4c', '#e5552a'], depth: '#9c3415', ink: '#4a1a0a' },
      { id: 'ocean', name: 'Ocean', background: ['#4facfe', '#00d4fe', '#a1ffce'], button: ['#36a3ff', '#1468d8'], depth: '#0c3f8a', ink: '#0d2f66' },
      { id: 'mint', name: 'Mint', background: ['#9ef08a', '#6fe8c8', '#dcfca0'], button: ['#2fd59a', '#139c6c'], depth: '#0b6646', ink: '#0d4f37' },
      { id: 'grape', name: 'Grape', background: ['#c471f5', '#fa71cd', '#f3c8ff'], button: ['#b25cff', '#8130e0'], depth: '#521a99', ink: '#3b1a4a' },
      { id: 'cherry', name: 'Cherry', background: ['#ff5c6c', '#f857a6', '#ffc3a0'], button: ['#ff4f6d', '#d61f45'], depth: '#8c0f2b', ink: '#4a0a1c' },
      { id: 'gold', name: 'Gold', background: ['#f6d365', '#fda085', '#fff1a8'], button: ['#ffbf2f', '#e08a00'], depth: '#945a00', ink: '#4a2c00' },
      { id: 'midnight', name: 'Midnight', background: ['#26336e', '#5b2c8f', '#a044ff'], button: ['#7a5cff', '#4b2fcf'], depth: '#24137a', ink: '#1a1046' },
    ],

    CASCADE_BANNERS: { 2: 'Tasty!', 3: 'Sweet!', 4: 'Delicious!', 5: 'Divine!' },
    CASCADE_BANNER_MAX: 'Sugar Storm!',

    TIMING: {
      SWAP_MS: 140,
      INVALID_MS: 300,
      SWELL_MS: 70,
      POP_MS: 180,
      WAVE_GAP_MS: 120,
      FALL_STEP_MS: 95, // time for the first cell of a free fall; later cells are faster (gravity)
      LAND_SQUASH_MS: 130,
      SHIMMER_EVERY_MS: 2600,
      STRIPE_SHIMMER_MS: 3000,
    },

    // Animation speed setting -> playback multiplier ("Snappy" is the default).
    ANIMATION_SPEEDS: { normal: 0.85, snappy: 1, fast: 1.4 },
    // Auto-hint setting -> idle delay in ms (null = off). Instant shows within 400 ms of the board settling.
    AUTO_HINT_DELAYS: { instant: 250, '3s': 3000, '8s': 8000, off: null },

    MAX_PARTICLES: 600,
    MAX_CELL_PX: 76,
    SWIPE_THRESHOLD: 0.35, // fraction of a cell
    FRAME_BUDGET_MS: 24, // adaptive quality kicks in when the average frame time exceeds this for 2 s
  };

  SC.CONFIG = CONFIG;
  SC.GAME_TITLE = CONFIG.GAME_TITLE;
  if (typeof module === 'object' && module.exports) module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
