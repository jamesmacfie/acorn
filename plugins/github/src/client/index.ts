// The github plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// `required: true`, matching the node half. The PR pane is the fallback the task view falls back TO
// when the last unpinned pane closes (ui.md § Task view), so a shell without it has no floor.
//
// What is NOT here, and is Phase 3's: App.tsx still imports PullList, PullDetail, CreatePullForm,
// ComparePreview and DiffView directly to render the GitHub browse route. That is the first line of
// plugins.md's coupling table ("shell/palette stop importing feature UI"), and moving it needs the
// browse route itself to become a contribution — a shell change, not a registration change.
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { linearContentLinkContribution, contentLinkRegistry } from './contentLinks'
import { prFiltersSlice } from './pullList/filterSlice'
import { prPaneContribution } from './pullDetail/PrPane'
import { pullFilePaletteSlotContribution } from './slotContribution'

export const githubClientPlugin: ClientPlugin = {
  name: 'github',
  required: true,
  init: (ctx) => {
    ctx.panes.register(prPaneContribution)
    ctx.slots.register(pullFilePaletteSlotContribution)
    ctx.persistedState.register(prFiltersSlice)
    // The Linear-issue link recogniser, registered by GITHUB and not by linear. It is defined here
    // (contentLinks.ts) because this plugin owns the registry and the two built-in GitHub patterns
    // beside it; having linear register it would mean linear importing github's client internals — a
    // new plugin→plugin edge, and the boundary ledger may shrink but never grow.
    //
    // Unconditional, exactly as before: the app registered it as part of an integration-provider
    // record that was itself registered unconditionally. Recognising a linear.app URL with no Linear
    // connection just opens a panel that reports there is none.
    if (!contentLinkRegistry.get(linearContentLinkContribution.id)) {
      contentLinkRegistry.register(linearContentLinkContribution)
    }
  },
}
