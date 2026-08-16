import { createSignal, For, Show } from 'solid-js'
import { collectionContributions } from '../registries/collections'
import { Button, SectionHeader } from '../ui/primitives'
import Icon from '../ui/Icon'
import { Menu } from '../ui/Menu'
import { panelMoveTarget } from './compose'
import type { PanelDefinition } from './model'
import Panel from './Panel'
import PanelEditor from './PanelEditor'
import { panelsAt, placePanel, removePanel, savePanel, type PlacementScope } from './persist'
import './dashboards.css'

// One PLACEMENT (docs/future/dashboards/placements.md): the grid of panels a person put somewhere,
// plus the chrome for putting one there and taking it away. Panel itself is placement-agnostic and
// owns a panel's frame, freshness and body; this owns the arrangement, and nothing else.
//
// It takes a scope rather than assuming home because `panelsAt` / `placePanel` already do — a task
// pane or a plugin-reserved region is this component with a different scope, not a second one.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO:
//
//   It never announces itself. With nothing placed there is no heading, no empty grid and no
//   invitation — just one ghost button under whatever the surface already showed. A person who
//   never asked for dashboards should not be able to tell this shipped.
//
//   It offers nothing when no plugin provides a collection. An "Add panel" that opens an empty
//   picker is worse than no button, so the affordance is gated on there being something to add.
//   Panels already placed still render — a plugin going away must not take a composition with it.

export default function PanelGrid(props: { scope: PlacementScope }) {
  // One signal for both entry points, because there is one editor: the wrapper distinguishes "open,
  // editing nothing yet" from "closed", which a bare `PanelDefinition | undefined` cannot.
  const [editing, setEditing] = createSignal<{ panel?: PanelDefinition } | undefined>()
  const panels = () => panelsAt(props.scope)
  const collections = () => collectionContributions()

  const move = (id: string, index: number, delta: -1 | 1) => {
    const target = panelMoveTarget(index, delta, panels().length)
    if (target === undefined) return
    placePanel(props.scope, id, target)
  }

  // Move-up/move-down in the overflow menu, and no drag. Reorder by menu is keyboard- and
  // screen-reader-operable by construction, where drag needs a parallel keyboard path built anyway
  // to be usable at all. Upgrade path: pointer drag ON TOP of this, never instead of it.
  const chrome = (definition: PanelDefinition, index: () => number) => (
    <Menu
      ariaLabel={`${definition.title} panel actions`}
      placement="bottom-end"
      trigger={({ toggle }) => (
        <Button size="xs" variant="ghost" iconOnly aria-label={`${definition.title} panel actions`} onClick={toggle}>
          <Icon name="ellipsis" />
        </Button>
      )}
    >
      {(menu) => (
        <>
          {/* The same generated editor the add flow opens, handed the panel it is editing. */}
          <Menu.Item context={menu} onSelect={() => setEditing({ panel: definition })}>Edit</Menu.Item>
          <Menu.Separator />
          <Menu.Item
            context={menu}
            disabled={panelMoveTarget(index(), -1, panels().length) === undefined}
            onSelect={() => move(definition.id, index(), -1)}
          >
            Move up
          </Menu.Item>
          <Menu.Item
            context={menu}
            disabled={panelMoveTarget(index(), 1, panels().length) === undefined}
            onSelect={() => move(definition.id, index(), 1)}
          >
            Move down
          </Menu.Item>
          <Menu.Separator />
          {/* `removePanel` rather than `unplacePanel`: home is the only placement this build draws,
              so an unplaced panel would be unreachable rather than filed. When a second placement
              lands this becomes "Remove from here" beside a delete.

              Still no confirmation, and the editor has since made a definition worth more
              than it was — filters, a sort, a projection. The ceiling is one misclick costing a
              minute of re-composing. Upgrade path: `createArmedConfirm` (ui/confirm.ts), which is
              already what every other destructive row in the app uses. */}
          <Menu.Item context={menu} tone="danger" onSelect={() => removePanel(definition.id)}>Remove</Menu.Item>
        </>
      )}
    </Menu>
  )

  const addButton = () => (
    <Button size="sm" variant="ghost" onClick={() => setEditing({})}>
      <Icon name="plus" /> Add panel
    </Button>
  )

  return (
    <Show when={panels().length || collections().length}>
      <section class="dash-placement">
        {/* The fallback needs no gate of its own: reaching it means no panels, and the Show above
            already established that there is then at least one collection to offer. */}
        <Show when={panels().length} fallback={<div class="dash-placement-add">{addButton()}</div>}>
          <SectionHeader level="group" actions={<Show when={collections().length}>{addButton()}</Show>}>
            Panels
          </SectionHeader>
          <div class="dash-grid">
            <For each={panels()}>
              {(definition, index) => (
                <Panel definition={definition} actions={chrome(definition, index)} />
              )}
            </For>
          </div>
        </Show>

        <Show when={editing()}>
          {(session) => (
            <PanelEditor
              collections={collections()}
              {...(session().panel ? { panel: session().panel } : {})}
              onClose={() => setEditing(undefined)}
              onSave={(panel) => {
                savePanel(panel)
                // Placed only when it is not already here. An edit that re-placed the panel would
                // silently move it to the end of the grid every time somebody changed its title.
                if (!panels().some((entry) => entry.id === panel.id)) placePanel(props.scope, panel.id)
              }}
            />
          )}
        </Show>
      </section>
    </Show>
  )
}
