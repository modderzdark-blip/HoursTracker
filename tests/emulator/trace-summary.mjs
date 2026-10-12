// Summarises a trace from cdp-trace.mjs: for the busiest threads, the event names that took the most time and the
// longest single events (nested events are counted under each of their parents too, so totals overlap).
// Usage: node tests/emulator/trace-summary.mjs <trace.json.gz> [threads] [rows]
import fs from 'node:fs';
import zlib from 'node:zlib';

const [trace_path, threads_text, rows_text] = process.argv.slice(2);
const max_threads = Number(threads_text || 6);
const max_rows = Number(rows_text || 12);
const { traceEvents: events } = JSON.parse(zlib.gunzipSync(fs.readFileSync(trace_path)).toString('utf8'));

const names = new Map();
events.forEach((event) => {
  if (event.ph === 'M' && event.name === 'thread_name') names.set(`${event.pid}:${event.tid}`, event.args.name);
});
const threads = new Map();
const open = new Map();
// Wrappers that only say a task ran; the names inside them say what it was.
const WRAPPERS = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'ThreadPool_RunTask', 'Receive mojo message', 'SimpleWatcher::OnHandleReady', 'EpollEvent', 'Graphics.Pipeline', 'TaskGraphRunner::RunTask']);
function add(key, name, dur, ts) {
  if (WRAPPERS.has(name)) return;
  if (!threads.has(key)) threads.set(key, { busy: 0, totals: new Map(), longest: [] });
  const thread = threads.get(key);
  thread.totals.set(name, (thread.totals.get(name) || 0) + dur);
  thread.longest.push({ name, dur, ts });
}
events.forEach((event) => {
  const key = `${event.pid}:${event.tid}`;
  if (event.ph === 'X' && event.dur) add(key, event.name, event.dur, event.ts);
  else if (event.ph === 'B') {
    if (!open.has(key)) open.set(key, []);
    open.get(key).push(event);
  } else if (event.ph === 'E' && open.has(key) && open.get(key).length) {
    const begin = open.get(key).pop();
    add(key, begin.name, event.ts - begin.ts, begin.ts);
  }
});
// A thread's busy time: the union of its events (wrappers aside).
threads.forEach((thread) => {
  const spans = thread.longest.map((item) => [item.ts, item.ts + item.dur]).sort((a, b) => a[0] - b[0]);
  let end = -Infinity;
  spans.forEach(([start, stop]) => {
    if (start >= end) {
      thread.busy += stop - start;
      end = stop;
    } else if (stop > end) {
      thread.busy += stop - end;
      end = stop;
    }
  });
});
const start_ts = events.reduce((low, event) => (event.ts && event.ts < low ? event.ts : low), Infinity);
const ms = (us) => (us / 1000).toFixed(1);
Array.from(threads.entries()).sort((a, b) => b[1].busy - a[1].busy).slice(0, max_threads).forEach(([key, thread]) => {
  console.log(`\n== ${names.get(key) || key} (${key}): busy ${ms(thread.busy)} ms`);
  console.log('  most time:');
  Array.from(thread.totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, max_rows).forEach(([name, dur]) => console.log(`    ${ms(dur).padStart(9)} ms  ${name}`));
  console.log('  longest:');
  thread.longest.sort((a, b) => b.dur - a.dur).slice(0, max_rows).forEach((item) => console.log(`    ${ms(item.dur).padStart(9)} ms  at +${ms(item.ts - start_ts)} ms  ${item.name}`));
});
