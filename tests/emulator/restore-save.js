// Evaluated in the debug build's WebView by cdp-eval.mjs: puts back the save that seed-level-19000.js stashed, persists it
// through the game's own store, then reloads.
(async () => {
  const STORAGE = window.SC.STORAGE;
  const store = window.SC.game.store;
  const live = store.save;
  const text = sessionStorage.getItem('sc_test_stashed_save');
  if (!text) throw new Error('no stashed save to restore');
  const restored = STORAGE.parseSave(text).save;
  Object.keys(live).forEach((key) => delete live[key]);
  Object.assign(live, restored);
  await store.persist();
  sessionStorage.removeItem('sc_test_stashed_save');
  setTimeout(() => location.reload(), 300);
  return { unlocked: live.unlocked };
})()
