// The github plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// `required: true`, matching the node half. The PR pane is the fallback the task view falls back TO
// when the last unpinned pane closes (ui.md § Task view), so a shell without it has no floor.
//
// The browse SURFACE is here as of Phase 3 (GithubBrowse.tsx), which is plugins.md's coupling-table row 1.
// App.tsx used to render the three-pane review layout in its `<Switch>` fallback and import five of this
// plugin's components to do it, because client-core/tabs/sources.ts hardcoded `github` ahead of the source
// registry while every other Source went through `<Dynamic>`. Now github is an ordinary source and the
// hardcoding is gone. Phase 3 replaced it with a rule that this plugin had to sit FIRST in apps/desktop's
// client plugin list, because rail order was registration order; that is no longer true either — the source
// declares `order` and this plugin's position in the list means nothing.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { linearContentLinkContribution, contentLinkRegistry } from './contentLinks'
import { prFiltersSlice } from './pullList/filterSlice'
import { prPaneContribution } from './pullDetail/PrPane'
import { pullFilePaletteSlotContribution } from './slotContribution'

const GithubBrowse = lazy(() => import('./GithubBrowse'))

export const githubClientPlugin: ClientPlugin = {
  name: 'github',
  required: true,
  init: (ctx) => {
    // No `providerId`: unlike linear's and rollbar's, this source is NOT gated on a connected integration
    // row. It has to be visible before GitHub is connected — that browse surface is where a fresh install
    // ends up, and gating it would leave first run with no source at all.
    //
    // No `promotion` either: github's browse creates a task inline from its PR list (seeding provider links
    // as it goes) rather than through PromoteToTaskModal, so there is nothing for the registry to hold.
    // `order: 10` is what puts GitHub at the head of the rail. Declared, so it survives this plugin being
    // moved anywhere in the client plugin list.
    ctx.sources.register({ id: 'github', order: 10, glyph: '◇', label: 'GitHub', component: GithubBrowse, defaultPane: 'pr' })
    ctx.panes.register(prPaneContribution)
    ctx.slots.register(pullFilePaletteSlotContribution)
    ctx.persistedState.register(prFiltersSlice)
    // The Linear-issue link recogniser, registered by GITHUB and not by linear. It is defined here
    // (contentLinks.ts) because this plugin owns the registry and the two built-in GitHub patterns
    // beside it; having linear register it would mean linear importing github's client internals — a
    // new plugin→plugin edge, and the boundary ledger may shrink but never grow.
    //
    // Through `ctx.contribute`, not `contentLinkRegistry.register` directly. `contentLinkRegistry` is this
    // plugin's own, so client-core cannot name it as a contribution point — but registering it by hand meant
    // the host held no disposable for it, and that has two consequences: Phase 4's disable could not take this
    // one contribution back, and a re-activation would hit the registry's duplicate-id throw. The
    // `if (!get(id))` probe that used to sit here was papering over exactly that.
    //
    // Unconditional, exactly as before: the app registered it as part of an integration-provider
    // record that was itself registered unconditionally. Recognising a linear.app URL with no Linear
    // connection just opens a panel that reports there is none.
    ctx.contribute(contentLinkRegistry, linearContentLinkContribution)
  },
}
