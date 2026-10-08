// Debug-build-only emulator test hook (packaged only into the debug APK via a Gradle debug source set).
(function emulatorTestHook() {
  console.log('SCTEST ' + JSON.stringify({ type: 'ready', width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }));
})();
