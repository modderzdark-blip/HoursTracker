// Evaluated in the debug build's WebView by cdp-eval.mjs: replaces the save with a synthetic one that has cleared
// levels 1 to 18,999 (1-3 stars each) and is on level 19,000, persists it through the game's own store, then reloads.
// The player's real save is stashed in sessionStorage (it survives the reload) so restore-save.js can put it back.
(async () => {
  const STORAGE = window.SC.STORAGE;
  const store = window.SC.game.store;
  const live = store.save;
  sessionStorage.setItem('sc_test_stashed_save', STORAGE.serializeSave(live));
  const save = STORAGE.defaultSave();
  save.player_name = live.player_name || '';
  save.name_asked = true;
  save.settings = Object.assign({}, live.settings, { comfort_done: true });
  save.meta = Object.assign({}, live.meta, { in_progress: 0 });
  const started = performance.now();
  for (let level = 1; level < 19000; level += 1) STORAGE.recordResult(save, level, { won: true, score: 9000 + (level % 9) * 1000, stars: 1 + (level % 3) });
  save.unlocked = 19000;
  const build_ms = performance.now() - started;
  Object.keys(live).forEach((key) => delete live[key]);
  Object.assign(live, STORAGE.normalizeSave(save));
  await store.persist();
  const text = STORAGE.serializeSave(live);
  const parse_started = performance.now();
  const parsed = STORAGE.parseSave(text);
  const parse_ms = performance.now() - parse_started;
  setTimeout(() => location.reload(), 300);
  return { save_bytes: text.length, parse_ms: Math.round(parse_ms * 10) / 10, build_ms: Math.round(build_ms), unlocked: parsed.save.unlocked, stars: STORAGE.totalStars(parsed.save) };
})()
