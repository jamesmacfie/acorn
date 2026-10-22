import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The plugin frame's stylesheet: the desktop's `app-plugin://` handler and the phone's sandbox domain both
// serve it at `/ui.css` (apps/desktop/src-tauri/src/plugin_scheme.rs, apps/mobile/scripts/build-sandbox.mjs). The
// renderer gets these modules through Vite; neither host can, so they are concatenated at build time.
//
// Presentation only. Feature and data styles stay out: the list covers what the public UI entrypoint
// needs — primitives, tabs, modals/mentions, copy controls, tooltips, picker chrome, diff rows, and
// the style-pack structural overrides — so components imported from @acorn/plugin-api/ui keep the
// same class contract inside a frame as outside one. Token values arrive over the bridge for the
// active theme and style axes, not from here.
//
// The order is the cascade, so it is the list rather than a directory scan.
// cssHygiene.test.ts reads this array and checks that what a frame is served covers every class
// primitives.css styles.
export const FRAME_STYLES = [
  'infra/styles/base.css',
  'infra/styles/primitives.css',
  'infra/styles/overlays.css',
  'infra/styles/tabs.css',
  // The delegated tooltip bubble. A frame mounts its own listener, `mountFrameTips` from
  // client-core/kit/lib/controls/frameTips.ts, because the shell's singleton cannot see into another document. It
  // lives apart from kit/components/overlays/tips.tsx so a frame bundle does not pull Solid and the primitives in with it.
  'kit/components/overlays/tips.css',
  'infra/styles/topbar.css',
  'infra/styles/diff.css',
  'infra/styles/style-modern.css',
  'infra/styles/style-cozy.css',
  'infra/styles/style-cute.css',
]

export const readFrameStyles = (): string =>
  FRAME_STYLES.map((rel) => readFileSync(resolve(import.meta.dirname, '../..', rel), 'utf8')).join('\n')
