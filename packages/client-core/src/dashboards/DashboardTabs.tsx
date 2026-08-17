import { createSignal, Index, Show } from 'solid-js'
import { Button, Input } from '../ui/primitives'
import { createArmedConfirm } from '../ui/confirm'
import { createListNavigation } from '../ui/focus'
import Icon from '../ui/Icon'
import { ContextMenu, Menu, type MenuContext } from '../ui/Menu'
import { addTab, homeTabDomId, HOME_TAB_PANEL_ID, renameTab, shiftTab } from './homeTab'
import { MAX_TABS, removeHomeTab, setHomeTabs, type DashboardTab } from './persist'

// The Home tab bar (docs/future/dashboards/tabs.md). It draws a list of names and calls three
// functions; a tab's CONTENT is the ordinary `home/<tabId>` placement the grid beside it renders, so
// there is nothing here about panels at all.
//
// IT IS NOT `ui/Tabs.tsx`, and that is the one judgement call in the file. A tab here carries an
// inline rename input and an overflow trigger, and neither can live inside a `<button role="tab">`
// without nesting interactive elements. Growing the shared strip a JSX-label and a trailing slot for
// one consumer buys a worse primitive; the roving/arrow behaviour it would have supplied is
// `createListNavigation`, which is the same three lines either way.
//
// The root is a `<span>` because the bar takes the section header's LABEL seat — tabs are the heading
// when there are several (`SectionHeader`, primitives.tsx).

export default function DashboardTabs(props: {
  tabs: readonly DashboardTab[]
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

  const onKeyDown = createListNavigation({
    count: () => props.tabs.length,
    active: () => Math.max(0, props.tabs.findIndex((tab) => tab.id === props.active)),
    setActive: (index) => select(props.tabs[index].id),
  })

  // ── The verbs ───────────────────────────────────────────────────────────────────────────────
  //
  // Create, rename and reorder are all `setHomeTabs` over a list the pure helpers produce
  // (homeTab.ts); only delete is its own action, because it also drops the placements and geometry.

  const create = () => {
    const { tabs, id } = addTab(props.tabs)
    setHomeTabs(tabs)
    props.onSelect(id)
    // Straight into the rename, because a tab called "New dashboard" forever is what happens when
    // naming it is a second trip.
    setRenaming(id)
  }

  const commitRename = (tab: DashboardTab, value: string) => {
    // Enter commits and then returns focus to the tab, which blurs the input — so both paths land
    // here and the first one to arrive is the one that counts.
    if (renaming() !== tab.id) return
    setRenaming(undefined)
    const name = value.trim()
    // A blank name would be dropped by the codec and the tab would come back as "Untitled", which is
    // a strange thing for "rename" to do. Nothing typed, nothing changed.
    if (name && name !== tab.name) setHomeTabs(renameTab(props.tabs, tab.id, name))
    focusTab(tab.id)
  }

  const remove = (tab: DashboardTab) => {
    removeHomeTab(tab.id)
    if (props.active === tab.id) props.onSelect('')
  }

  /** The same items on the overflow and on the context menu — one list, so the two cannot drift. */
  const verbs = (tab: DashboardTab, menu: MenuContext) => (
    <>
      <Menu.Item context={menu} onSelect={() => { props.onSelect(tab.id); setRenaming(tab.id) }}>Rename</Menu.Item>
      <Menu.Separator />
      <Menu.Item
        context={menu}
        disabled={props.tabs[0]?.id === tab.id}
        onSelect={() => setHomeTabs(shiftTab(props.tabs, tab.id, -1))}
      >
        Move left
      </Menu.Item>
      <Menu.Item
        context={menu}
        disabled={props.tabs[props.tabs.length - 1]?.id === tab.id}
        onSelect={() => setHomeTabs(shiftTab(props.tabs, tab.id, 1))}
      >
        Move right
      </Menu.Item>
      {/* The default tab is the bare `home` scope. "Delete" of it would only mean "empty it", and it
          is the one tab that must stay reachable. */}
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
              <Input
                size="sm"
                width="auto"
                class="dash-tab-rename"
                aria-label={`Rename ${tab().name}`}
                // Uncontrolled on purpose: the input owns the text until it commits, so nothing in the
                // model changes per keystroke and Escape has something to go back to.
                value={tab().name}
                // Bare `autofocus` is unreliable inside a conditional in Solid; the microtask is the
                // house workaround.
                ref={(el: HTMLInputElement) => queueMicrotask(() => { el.focus(); el.select() })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename(tab(), event.currentTarget.value)
                  else if (event.key === 'Escape') commitRename(tab(), tab().name)
                }}
                onBlur={(event) => commitRename(tab(), event.currentTarget.value)}
              />
            </Show>
            <Show when={props.active === tab().id && renaming() !== tab().id}>
              <Menu
                ariaLabel={`${tab().name} dashboard actions`}
                placement="bottom-start"
                trigger={({ open, toggle }) => (
                  <Button
                    size="xs"
                    variant="ghost"
                    iconOnly
                    aria-label={`${tab().name} dashboard actions`}
                    {...(open() ? { 'data-open': '' } : {})}
                    onClick={toggle}
                  >
                    <Icon name="chevron-down" />
                  </Button>
                )}
              >
                {(menu) => verbs(tab(), menu)}
              </Menu>
            </Show>
          </span>
        )}
      </Index>

      {/* The ghost `+`. Past the cap it stays visible and disabled — a button that vanishes at eight
          is a bug report. */}
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        class="dash-tab-add"
        aria-label="New dashboard"
        title={props.tabs.length >= MAX_TABS ? `${MAX_TABS} dashboards is the limit.` : 'New dashboard'}
        disabled={props.tabs.length >= MAX_TABS}
        onClick={create}
      >
        <Icon name="plus" />
      </Button>

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
