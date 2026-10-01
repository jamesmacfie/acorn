import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = process.argv[2] && resolve(process.argv[2]);
const output = process.argv[3] && resolve(process.argv[3]);
if (!baseline || !output) throw new Error('Usage: node bench-startup-unit01.mjs BASELINE_SOURCE OUTPUT_JSON');
const bundledRoot = join(checkout, 'apps/desktop/dist/bundled-plugins');
const evidence = { runtime: process.version, baseline, checkout, bundledRoot, rounds: [] };
for (let round = 0; round < 5; round++) {
  const variants = round % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
  for (const variant of variants) {
    const item = { round, variant };
    for (const workload of ['reconcile', 'trust']) {
      const script = join(checkout, `plans/performance/bench-startup-${workload}.mjs`);
      const result = spawnSync(process.execPath, ['--import', 'tsx', script, bundledRoot], {
        cwd: variant === 'before' ? baseline : checkout,
        encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ACORN_PERF_TAG: `unit01-${variant}` },
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${variant} ${workload} failed: ${result.stderr}`);
      item[workload] = JSON.parse(result.stdout);
    }
    evidence.rounds.push(item);
  }
}
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
console.log(`Saved ${evidence.rounds.length} interleaved cases to ${output}`);
