import { createSignal, For, onCleanup, Show, type Accessor, type JSX } from 'solid-js'
import type { DashboardRevision, PanelPlan } from '@acorn/protocol/dashboards.ts'
import { availableViews, switchView } from '@acorn/dashboards-core/outline.ts'
import { outputPlanColumns } from '@acorn/dashboards-core/plan.ts'
import { sortDirectionLabel } from '@acorn/dashboards-core/labels.ts'
import { Kbd } from '../../kit/components/content/Kbd'
import { Text } from '../../kit/components/content/Text'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Menu, type MenuContext } from '../../kit/components/overlays/Menu'
import { formatChord } from '../../kit/lib/rendering/formatChord'
import type { PanelDefinition } from './model'
import PanelAbout from './PanelAbout'
import PublishedDashboardPanel from './PublishedDashboardPanel'
import { regionRefusal, type PanelRegion } from './region'

export type PanelGridGestureKind = 'move' | 'resize' | 'keyboard'

export type PanelGridItemLayout = {
  collapsed: Accessor<boolean>
  style: Accessor<JSX.CSSProperties>
  gestureKind: Accessor<PanelGridGestureKind | undefined>
  keyboardActive: Accessor<boolean>
  announcement: Accessor<string>
  register: (element: HTMLDivElement) => void
  unregister: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onBlur: () => void
  onBeginDrag: (event: PointerEvent) => void
  onBeginResize: (edge: 'e' | 's' | 'se', event: PointerEvent) => void
}

export type PanelGridItemActions = {
  edit: () => void
  editWithAi: () => void
  /** Opens the studio on any panel, such as one a drill-down just added. */
  openStudio: (dashboardId: string) => void
  /** Makes one change to the published plan and publishes it straight away. */
  quickEdit: (edit: (plan: PanelPlan) => PanelPlan) => void
  canDuplicate: () => boolean
  duplicate: (plan: PanelPlan) => void
  beginLayout: () => void
  canMove: (delta: -1 | 1) => boolean
  move: (delta: -1 | 1) => void
  moveTargets: () => readonly { id: string; name: string }[]
  moveToTab: (tabId: string) => void
  remove: () => void
  delete: () => Promise<void>
  deleteFailed: () => void
}

type Direction = NonNullable<PanelPlan['sort']>[number]['direction']
const capitalized = (words: string) => words[0]!.toUpperCase() + words.slice(1)

/** The plan sorted by a column first. Other sort columns stay behind it, in their order. */
const sortedBy = (plan: PanelPlan, column: string): PanelPlan => {
  const [first, ...rest] = plan.sort ?? []
  return { ...plan, sort: [{ ...first, column, direction: first?.direction ?? 'desc' }, ...rest.filter(entry => entry.column !== column)] }
}
const sortedTowards = (plan: PanelPlan, direction: Direction): PanelPlan =>
  ({ ...plan, sort: (plan.sort ?? []).map((entry, index) => index === 0 ? { ...entry, direction } : entry) })

/**
 * One placed panel's render boundary and chrome. Geometry remains owned by PanelGrid and arrives as a
 * small layout port; this component owns no placement state and cannot commit a gesture itself.
 *
 * The menu's quick edits, About, and Duplicate read the published revision the panel already loaded
 * (docs/dashboards/placements.md § The panel menu).
 */
export default function PanelGridItem(props: {
  definition: PanelDefinition
  workspaceId?: string
  scope: import('./persist').PlacementScope
  /** The plugin region this grid draws, which limits the views a panel can switch to. */
  region?: PanelRegion
  layout: PanelGridItemLayout
  actions: PanelGridItemActions
}) {
  const [renaming, setRenaming] = createSignal(false)
  const [about, setAbout] = createSignal<DashboardRevision>()
  const quickEdit = (edit: (plan: PanelPlan) => PanelPlan) => props.actions.quickEdit(edit)
  const rename = (title: string | undefined, current: string) => {
    setRenaming(false)
    if (title !== undefined && title !== current) quickEdit(plan => ({ ...plan, title }))
  }

  // `Menu` has no submenu, so View as and Sort by are flat labelled groups, as Move to is.
  const quickEditItems = (menu: MenuContext, plan: PanelPlan) => {
    const views = () => availableViews(plan).map(entry => {
      const refused = props.region ? regionRefusal(props.region, entry.id, {}) : undefined
      return { ...entry, available: entry.available && !refused, reason: entry.reason ?? refused }
    })
    const columns = () => outputPlanColumns(plan)
    const sort = () => plan.sort?.[0]
    const sortType = () => columns().find(column => column.id === sort()?.column)?.type
    return <>
      <Menu.Separator />
      <Menu.Label>View as</Menu.Label>
      <For each={views()}>{view => (
        <Menu.Item context={menu} kind="radio" checked={view.id === plan.view.kind} disabled={!view.available && view.id !== plan.view.kind}
          trailing={<Show when={!view.available && view.reason}>{reason => <Text emphasis="muted">{reason()}</Text>}</Show>}
          onSelect={() => { if (view.id !== plan.view.kind) quickEdit(current => switchView(current, view.id)) }}>{view.label}</Menu.Item>
      )}</For>
      <Menu.Separator />
      <Menu.Label>Sort by</Menu.Label>
      <For each={columns()}>{column => (
        <Menu.Item context={menu} kind="radio" checked={column.id === sort()?.column}
          onSelect={() => { if (column.id !== sort()?.column) quickEdit(current => sortedBy(current, column.id)) }}>{column.label}</Menu.Item>
      )}</For>
      <For each={['asc', 'desc'] as const}>{direction => (
        <Menu.Item context={menu} kind="radio" checked={!!sort() && sort()!.direction === direction} disabled={!sort()}
          onSelect={() => { if (sort()?.direction !== direction) quickEdit(current => sortedTowards(current, direction)) }}>
          {capitalized(sortDirectionLabel(direction, sortType()))}
        </Menu.Item>
      )}</For>
    </>
  }

  const chrome = (published: Accessor<DashboardRevision | undefined>) => (
    <Menu
      ariaLabel={`${props.definition.title} panel actions`}
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <IconButton
          size="xs"
          variant="ghost"
          icon="ellipsis"
          label={`${props.definition.title} panel actions`}
          // Header actions fade when the pointer leaves. `aria-expanded` keeps the trigger present
          // while its portalled menu owns pointer and focus (dashboards.css).
          opens="menu"
          expanded={open()}
          onPress={toggle}
        />
      )}
    >
      {(menu) => (
        <>
          <Menu.Item context={menu} onSelect={props.actions.edit} trailing={<Kbd size="xs">{formatChord('enter')}</Kbd>}>Edit…</Menu.Item>
          <Menu.Item context={menu} onSelect={props.actions.editWithAi}>Edit with AI…</Menu.Item>
          <Menu.Item context={menu} disabled={!published()} onSelect={() => setRenaming(true)}>Rename</Menu.Item>
          <Show when={published()}>{revision => quickEditItems(menu, revision().content)}</Show>
          <Menu.Separator />
          <Menu.Item context={menu} disabled={!published()} onSelect={() => setAbout(published())}>About this panel</Menu.Item>
          <Menu.Item context={menu} disabled={!published() || !props.actions.canDuplicate()} onSelect={() => props.actions.duplicate(published()!.content)}>
            Duplicate
          </Menu.Item>
          <Menu.Separator />
          <Show when={!props.layout.collapsed()}>
            <Menu.Item context={menu} onSelect={props.actions.beginLayout}>Move or resize</Menu.Item>
          </Show>
          <Menu.Item context={menu} disabled={!props.actions.canMove(-1)} onSelect={() => props.actions.move(-1)}>
            Move up
          </Menu.Item>
          <Menu.Item context={menu} disabled={!props.actions.canMove(1)} onSelect={() => props.actions.move(1)}>
            Move down
          </Menu.Item>
          <Show when={props.actions.moveTargets().length}>
            <Menu.Separator />
            <Menu.Label>Move to</Menu.Label>
            <For each={props.actions.moveTargets()}>
              {(tab) => <Menu.Item context={menu} onSelect={() => props.actions.moveToTab(tab.id)}>{tab.name}</Menu.Item>}
            </For>
          </Show>
          <Menu.Separator />
          {/* Remove keeps the definition for its other placements; Delete destroys it everywhere. */}
          <Menu.Item context={menu} onSelect={props.actions.remove}>Remove from this dashboard</Menu.Item>
          <Menu.Item
            context={menu}
            tone="danger"
            confirm="Delete panel?"
            onSelect={() => void props.actions.delete().catch(props.actions.deleteFailed)}
          >
            Delete panel
          </Menu.Item>
        </>
      )}
    </Menu>
  )

  const handle = (edge: 'e' | 's' | 'se') => (
    <div
      class={`dash-resize dash-resize-${edge}`}
      // The keyboard equivalent is the single menu action, not nine extra tab stops per panel.
      aria-hidden="true"
      onPointerDown={(event) => props.layout.onBeginResize(edge, event)}
    />
  )

  onCleanup(props.layout.unregister)

  return (
    <div
      class="dash-slot"
      ref={props.layout.register}
      style={props.layout.style()}
      tabindex={-1}
      {...(props.layout.gestureKind() ? { 'data-gesture': props.layout.gestureKind() } : {})}
      {...(props.layout.keyboardActive()
        ? {
          'aria-roledescription': 'movable panel',
          'aria-label': `${props.definition.title}. Arrows move, shift and arrows resize, Enter to finish, Escape to cancel.`,
        }
        : {})}
      onKeyDown={props.layout.onKeyDown}
      onBlur={props.layout.onBlur}
    >
      <Show when={props.definition.publication}>
        <PublishedDashboardPanel
          definition={props.definition}
          workspaceId={props.workspaceId}
          placement={props.scope}
          actions={chrome}
          {...(renaming() ? { rename: { onDone: (title: string | undefined) => rename(title, props.definition.title) } } : {})}
          onEditPanel={props.actions.openStudio}
          headProps={props.layout.collapsed() ? {} : { onPointerDown: props.layout.onBeginDrag }}
        />
      </Show>
      <Show when={about()}>{revision => (
        <PanelAbout revision={revision()} onDismiss={() => setAbout(undefined)}
          onEdit={() => { setAbout(undefined); props.actions.edit() }} />
      )}</Show>
      <Show when={!props.layout.collapsed()}>
        {handle('e')}
        {handle('s')}
        {handle('se')}
      </Show>
      <Show when={props.layout.keyboardActive()}>
        <div class="dash-caption" aria-hidden="true">
          <span>{props.layout.announcement()}</span>
          <span>Arrow keys move. Shift and arrows resize. Enter to finish.</span>
        </div>
      </Show>
    </div>
  )
}
