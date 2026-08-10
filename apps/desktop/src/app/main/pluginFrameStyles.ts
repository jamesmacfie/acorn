// The presentation-only stylesheet available to isolated plugin frames. These are the exact files
// the shell uses, compiled into Electron main as text so a packaged app does not need a second asset
// tree and components imported from @acorn/plugin-api/ui keep the same class contract.
//
// Feature/data styles stay out. The included modules cover the public UI entrypoint: primitives,
// tabs, modals/mentions, copy controls, picker chrome, diff rows, and the style-pack structural
// overrides. Actual token values arrive over the bridge for the active theme and style axes.
import base from '@acorn/client-core/styles/base.css?raw'
import copy from '@acorn/client-core/styles/copy.css?raw'
import diff from '@acorn/client-core/styles/diff.css?raw'
import overlays from '@acorn/client-core/styles/overlays.css?raw'
import primitives from '@acorn/client-core/styles/primitives.css?raw'
import cute from '@acorn/client-core/styles/style-cute.css?raw'
import modern from '@acorn/client-core/styles/style-modern.css?raw'
import cozy from '@acorn/client-core/styles/style-cozy.css?raw'
import tabs from '@acorn/client-core/styles/tabs.css?raw'
import picker from '@acorn/client-core/styles/topbar.css?raw'

export const pluginFrameStyles = [
  base,
  primitives,
  overlays,
  copy,
  tabs,
  picker,
  diff,
  modern,
  cozy,
  cute,
].join('\n')
