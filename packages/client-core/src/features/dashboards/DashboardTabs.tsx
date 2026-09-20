import { createSignal, Index, Show } from 'solid-js'
import { Input } from '../../kit/components/primitives'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { createArmedConfirm } from '../../kit/lib/confirm'
import { isTypingTarget } from '@acorn/protocol/keybindings.ts'
import { ContextMenu, Menu, type MenuContext } from '../../kit/components/overlays/Menu'
import { addTab, homeTabDomId, HOME_TAB_PANEL_ID, renameTab, shiftTab } from './homeTab'
import { MAX_TABS, removeHomeTab, setHomeTabs, type DashboardTab } from './persist'

// The Home tab bar (docs/dashboards.md § Persistence). It draws one workspace's list of names and
// calls three functions; a tab's content is the ordinary `home/<tabId>/<workspaceId>` placement the
// grid beside it renders, so there is nothing here about panels at all.
//
// This is not `ui/Tabs.tsx`, which is the one judgement call in the file. A tab here carries an
// inline rename input and an overflow trigger, and neither can live inside a `<button role="tab">`
// without nesting interactive elements. Growing the shared strip a JSX label and a trailing slot for
// one consumer buys a worse primitive; the roving/arrow behaviour it would have supplied is
// `createListNavigation`, the same three lines either way.
//
// The root is a `<span>` because the bar takes the section header's label seat: tabs are the heading
// when there are several (`SectionHeader`, primitives.tsx).

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'j'])
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'k'])

/** The tab title, editable in place. It holds its own element because the text is uncontrolled: the
 *  input owns it until it commits, so nothing in the model changes per keystroke and Escape has
 *  something to go back to. */
function RenameTab(props: { name: string; onCommit: (name: string) => void }) {
  let field: HTMLInputElement | undefined
  return (
    <Input
      size="sm"
      width="auto"
      label={`Rename ${props.name}`}
      value={props.name}
      // Bare `autofocus` is unreliable inside a conditional in Solid; the microtask is the house
      // workaround.
      ref={(el) => { field = el; queueMicrotask(() => { el.focus(); el.select() }) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onCommit(field?.value ?? props.name)
        else if (event.key === 'Escape') props.onCommit(props.name)
      }}
      onBlur={() => props.onCommit(field?.value ?? props.name)}
    />
  )
}

export default function DashboardTabs(props: {
  tabs: readonly DashboardTab[]
  /** Whose dashboards these are. Every write is scoped to it, so a workspace can only ever rewrite
   *  its own slice of the one `tabs` list. */
  workspaceId?: string
  active: string
  onSelect: (id: string) => void
}) {
  const [renaming, setRenaming] = createSignal<string>()
  const [menuAt, setMenuAt] = createSignal<{ x: number; y: number } | null>(null)
  const [menuTab, setMenuTab] = createSignal<DashboardTab>()
  const confirmDelete = createArmedConfirm()

  const focusTab = (id: string) => document.getElementById(homeTabDomId(id))?.focus()

  /** Activation follows focus: switching a tab is a local render, so there is nothing to defer. */
  const select = (id: string) => {
    props.onSelect(id)
    focusTab(id)
  }

  // Roving arrows over the strip, written here rather than taken from `keys/collection.ts`, which is
  // what every other collection in the app uses. The strip holds an inline rename `Input`, and an
  // intent layer binds Left and Right unconditionally, so a person renaming a tab would lose the
  // caret keys to tab movement. `isTypingTarget` is the whole difference, and it is three lines.
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return
    const count = props.tabs.length
    if (count <= 0) return
    const at = Math.max(0, props.tabs.findIndex((tab) => tab.id === props.active))
    const next
      = event.key === 'Home' ? 0
        : event.key === 'End' ? count - 1
          : NEXT_KEYS.has(event.key) ? (at + 1) % count
            : PREV_KEYS.has(event.key) ? (at - 1 + count) % count
              : at
    if (next === at) return
    event.preventDefault()
    select(props.tabs[next].id)
  }

  // ── The verbs ───────────────────────────────────────────────────────────────────────────────
  //
  // Create, rename and reorder are all `setHomeTabs` over a list the pure helpers produce
  // (homeTab.ts); only delete is its own action, because it also drops the placements and geometry.

  const create = () => {
    const { tabs, id } = addTab(props.tabs)
    setHomeTabs(tabs, props.workspaceId)
    props.onSelect(id)
    // Straight into the rename, because a tab called "New dashboard" forever is what happens when
    // naming it is a second trip.
    setRenaming(id)
  }

  const commitRename = (tab: DashboardTab, value: string) => {
    // Enter commits and then returns focus to the tab, which blurs the input, so both paths land
    // here and the first one to arrive is the one that counts.
    if (renaming() !== tab.id) return
    setRenaming(undefined)
    const name = value.trim()
    // A blank name would be dropped by the codec and the tab would come back as "Untitled", which is
    // a strange thing for "rename" to do. Nothing typed, nothing changed.
    if (name && name !== tab.name) setHomeTabs(renameTab(props.tabs, tab.id, name), props.workspaceId)
    focusTab(tab.id)
  }

  const remove = (tab: DashboardTab) => {
    removeHomeTab(tab.id, props.workspaceId)
    if (props.active === tab.id) props.onSelect('')
  }

  /** The same items on the overflow and on the context menu, one list, so the two cannot drift. */
  const verbs = (tab: DashboardTab, menu: MenuContext) => (
    <>
      <Menu.Item context={menu} onSelect={() => { props.onSelect(tab.id); setRenaming(tab.id) }}>Rename</Menu.Item>
      <Menu.Separator />
      <Menu.Item
        context={menu}
        disabled={props.tabs[0]?.id === tab.id}
        onSelect={() => setHomeTabs(shiftTab(props.tabs, tab.id, -1), props.workspaceId)}
      >
        Move left
      </Menu.Item>
      <Menu.Item
        context={menu}
        disabled={props.tabs[props.tabs.length - 1]?.id === tab.id}
        onSelect={() => setHomeTabs(shiftTab(props.tabs, tab.id, 1), props.workspaceId)}
      >
        Move right
      </Menu.Item>
      {/* The default tab is the workspace's bare `home//<ws>` scope. "Delete" of it would only mean
          "empty it", and it is the one tab that must stay reachable. */}
      <Show when={tab.id}>
        <Menu.Separator />
        {/* Armed, and the copy says what survives: arrangement is real work, definitions are not at
            risk (tabs.md § Survival rules). */}
        <Menu.Item
          context={menu}
          tone="danger"
          closeOnSelect={confirmDelete.armed() === tab.id}
          title="Panels stay in your library and on other tabs."
          onSelect={() => { if (confirmDelete.request(tab.id)) remove(tab) }}
        >
          {confirmDelete.armed() === tab.id ? 'Delete — press again' : 'Delete dashboard'}
        </Menu.Item>
      </Show>
    </>
  )

  return (
    <span class="dash-tabs" role="tablist" aria-label="Dashboards" onKeyDown={onKeyDown}>
      {/* `Index`, not `For`. `homeTabs` rebuilds its entries on every dashboard write, so a
          reference-keyed list would rebuild every row — and the row being rebuilt is the one holding
          the rename input a person is typing into (the recorded For/Index defocus trap). */}
      <Index each={props.tabs}>
        {(tab) => (
          <span class="dash-tab-slot">
            <Show
              when={renaming() === tab().id}
              fallback={(
                <button
                  id={homeTabDomId(tab().id)}
                  type="button"
                  role="tab"
                  class="dash-tab"
                  aria-selected={props.active === tab().id}
                  aria-controls={HOME_TAB_PANEL_ID}
                  tabindex={props.active === tab().id ? 0 : -1}
                  onClick={() => props.onSelect(tab().id)}
                  onDblClick={() => setRenaming(tab().id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenuTab(tab())
                    setMenuAt({ x: event.clientX, y: event.clientY })
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'F2' && !(event.key === 'Enter' && props.active === tab().id)) return
                    event.preventDefault()
                    setRenaming(tab().id)
                  }}
                >
                  {tab().name}
                </button>
              )}
            >
              <RenameTab name={tab().name} onCommit={(name) => commitRename(tab(), name)} />
            </Show>
            <Show when={props.active === tab().id && renaming() !== tab().id}>
              <Menu
                ariaLabel={`${tab().name} dashboard actions`}
                placement="bottom-start"
                trigger={({ open, toggle }) => (
                  <IconButton
                    size="xs"
                    variant="ghost"
                    icon="chevron-down"
                    label={`${tab().name} dashboard actions`}
                    {...(open() ? { 'data-open': '' } : {})}
                    onPress={toggle}
                  />
                )}
              >
                {(menu) => verbs(tab(), menu)}
              </Menu>
            </Show>
          </span>
        )}
      </Index>

      {/* The ghost `+`. Past the cap it stays visible and disabled: a button that vanishes at eight
          is a bug report. */}
      <IconButton
        size="xs"
        variant="ghost"
        icon="plus"
        label="New dashboard"
        title={props.tabs.length >= MAX_TABS ? `${MAX_TABS} dashboards is the limit.` : 'New dashboard'}
        disabled={props.tabs.length >= MAX_TABS}
        onPress={create}
      />

      <ContextMenu
        at={menuAt}
        ariaLabel={`${menuTab()?.name ?? 'Dashboard'} actions`}
        onClose={() => setMenuAt(null)}
        returnFocus={() => document.getElementById(homeTabDomId(menuTab()?.id ?? '')) ?? undefined}
      >
        {(menu) => <Show when={menuTab()}>{(tab) => verbs(tab(), menu)}</Show>}
      </ContextMenu>
    </span>
  )
}
