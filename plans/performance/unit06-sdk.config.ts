import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root,
  define: { 'globalThis.__ACORN_PROBE_DELAY__': process.env.ACORN_PERF_DELAY ?? '0' },
  resolve: { alias: { 'unit06-sdk': process.env.ACORN_PERF_SDK === 'legacy'
    ? '/tmp/acorn-perf-unit06-legacy-sdk/sdk.js'
    : root + 'packages/plugin-api/src/ui/sdk.ts' } },
  build: { outDir: `/tmp/acorn-perf-unit06-${process.env.ACORN_PERF_SDK ?? 'modern'}-bundle${process.env.ACORN_PERF_DELAY ? '-delayed' : ''}`, emptyOutDir: true,
    lib: { entry: root + 'plans/performance/unit06-sdk-entry.ts', formats: ['es'], fileName: 'bundle' },
    minify: false, target: 'esnext' },
})
