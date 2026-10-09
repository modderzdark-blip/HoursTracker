// Debug builds only: evaluates a script inside the game's WebView over the DevTools protocol and prints the result as
// JSON. Release builds do not enable WebView debugging, so this cannot reach them (apk-verify checks the flag).
// The caller forwards the WebView's DevTools socket first:
//   adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>
// Usage: node tests/emulator/cdp-eval.mjs <port> <script-file>
import fs from 'node:fs';

const [port, script_path] = process.argv.slice(2);
const expression = fs.readFileSync(script_path, 'utf8');

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
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('DevTools evaluate timed out')), 60000);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else if (message.result.exceptionDetails) reject(new Error(JSON.stringify(message.result.exceptionDetails)));
    else resolve(message.result.result.value);
  });
  socket.addEventListener('error', () => reject(new Error('DevTools socket error')));
});
socket.close();
console.log(JSON.stringify(result));
