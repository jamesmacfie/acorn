import { defineConfig, mergeConfig } from 'vitest/config'
import base from './15-probe.config.mts'
export default mergeConfig(base, defineConfig({
  resolve: { dedupe: ['solid-js'] },
  test: { include: ['plans/performance/unit17-tui-probe.test.tsx'], server: { deps: { inline: true } } },
}))
