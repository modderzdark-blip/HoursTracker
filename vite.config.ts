import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

interface PackageJson {
  version: string;
}

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as PackageJson;

function resolveBuildSha(): string {
  const fromEnv = process.env['BUILD_SHA'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/<repo>/) and inside Capacitor.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(resolveBuildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Rapier's compat build inlines its WASM as base64 (~4.1 MB raw, ~1.5 MB gzip) inside the lazily loaded engine chunk.
    chunkSizeWarningLimit: 5600,
  },
  server: { host: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
