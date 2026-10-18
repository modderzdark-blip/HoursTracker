import type { DeviceInfo } from './deviceInfo';
import type { LogRing } from './LogCapture';

export interface ReportInput {
  readonly build: { version: string; sha: string; time: string };
  readonly device: DeviceInfo;
  readonly stats: string;
  readonly settings: unknown;
  readonly log: LogRing | null;
  readonly maxEntries: number;
}

/** Plain-text bug report: build, device, live stats, settings, then the newest log lines. */
export function buildDebugReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push('=== ASHBOUND DEBUG LOG ===');
  lines.push(`build: v${input.build.version} (${input.build.sha}) built ${input.build.time}`);
  lines.push(`captured: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('--- device ---');
  for (const [k, v] of Object.entries(input.device)) lines.push(`${k}: ${String(v)}`);
  lines.push('');
  lines.push('--- stats ---');
  lines.push(input.stats);
  lines.push('');
  lines.push('--- settings ---');
  lines.push(JSON.stringify(input.settings));
  lines.push('');
  const log = input.log;
  if (log === null) {
    lines.push('--- log: capture not installed ---');
  } else {
    const entries = log.entries();
    const shown = entries.slice(-input.maxEntries);
    lines.push(
      `--- log (${shown.length} of ${entries.length} kept; ${log.errorCount} errors, ${log.warnCount} warnings total) ---`,
    );
    for (const e of shown) lines.push(`[${e.t.toFixed(2)}s] ${e.level.toUpperCase()} ${e.message}`);
  }
  lines.push('=== END ===');
  return lines.join('\n');
}
