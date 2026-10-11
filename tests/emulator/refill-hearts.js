// Evaluated in the debug build's WebView by cdp-eval.mjs when the long play loops run out of hearts and cannot afford a
// refill: a test-only top-up (players wait for hearts or buy a refill with Gold), so the loop keeps playing.
(async () => {
  const save = window.SC.game.store.save;
  save.meta.hearts = window.SC.META.MAX_HEARTS;
  save.meta.hearts_clock = Date.now();
  await window.SC.game.store.persist();
  return { hearts: save.meta.hearts };
})()
