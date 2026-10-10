// How many levels ship and in which packs (written by scripts/calibrate.js).
(function registerManifest(root) {
  'use strict';
  const MANIFEST = { count: 120, packs: [1,2] };
  root.SC_LEVEL_MANIFEST = MANIFEST;
  if (typeof module === 'object' && module.exports) module.exports = MANIFEST;
})(typeof window !== 'undefined' ? window : globalThis);
