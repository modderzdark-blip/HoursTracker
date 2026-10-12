// Debug builds only: records a performance trace of the game's WebView over the DevTools protocol for a number of
// seconds and saves it gzipped (open it in chrome://tracing or Perfetto, or read it with trace-summary.mjs). The trace
// covers the app's browser side too (the GPU thread runs inside the app on Android), so it shows where a slow frame
// goes on the device. The caller forwards the WebView's DevTools socket first:
//   adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>
// Usage: node tests/emulator/cdp-trace.mjs <port> <out.json.gz> <seconds>
import fs from 'node:fs';
import zlib from 'node:zlib';

const [port, out_path, seconds_text] = process.argv.slice(2);
const seconds = Number(seconds_text || 20);
const CATEGORIES = [
  'toplevel', 'benchmark', 'blink', 'cc', 'gpu', 'gpu.service', 'viz', 'skia', 'v8.execute', 'android_webview', 'ui', 'renderer.scheduler',
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-skia.gpu',
];

async function pageTarget() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === 'page' && /localhost/.test(target.url));
      if (page) return page;
    } catch (fetch_error) {
      // the socket is not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no WebView page on DevTools port ${port}`);
}

const target = await pageTarget();
const socket = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${target.id}`);
const events = [];
let next_id = 1;
const pending = new Map();
function send(method, params) {
  const id = next_id;
  next_id += 1;
  socket.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const complete = new Promise((resolve) => {
  socket.addEventListener('message', (message_event) => {
    const message = JSON.parse(message_event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: done, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else done(message.result);
      return;
    }
    if (message.method === 'Tracing.dataCollected') events.push(...message.params.value);
    if (message.method === 'Tracing.tracingComplete') resolve();
  });
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve);
  socket.addEventListener('error', () => reject(new Error('DevTools socket error')));
});
await send('Tracing.start', { traceConfig: { includedCategories: CATEGORIES, recordMode: 'recordContinuously' }, transferMode: 'ReportEvents' });
console.log(`tracing for ${seconds} s`);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
await send('Tracing.end');
await Promise.race([complete, new Promise((resolve) => setTimeout(resolve, 60000))]);
socket.close();
fs.writeFileSync(out_path, zlib.gzipSync(JSON.stringify({ traceEvents: events })));
console.log(`saved ${events.length} trace events to ${out_path}`);
