import { For, onCleanup, Show, type Accessor, type JSX } from 'solid-js'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Menu } from '../../kit/components/overlays/Menu'
import { createArmedConfirm } from '../../kit/lib/controls/confirm'
import type { PanelDefinition } from './model'
import PublishedDashboardPanel from './PublishedDashboardPanel'

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
  beginLayout: () => void
  canMove: (delta: -1 | 1) => boolean
  move: (delta: -1 | 1) => void
  moveTargets: () => readonly { id: string; name: string }[]
  moveToTab: (tabId: string) => void
  remove: () => void
  delete: () => Promise<void>
  deleteFailed: () => void
}

/**
 * One placed panel's render boundary and chrome. Geometry remains owned by PanelGrid and arrives as a
 * small layout port; this component owns no placement state and cannot commit a gesture itself.
 */
export default function PanelGridItem(props: {
  definition: PanelDefinition
  workspaceId?: string
  layout: PanelGridItemLayout
  actions: PanelGridItemActions
}) {
  const confirmDelete = createArmedConfirm()

  const chrome = () => (
    <Menu
      ariaLabel={`${props.definition.title} panel actions`}
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <IconButton
          size="xs"
          variant="ghost"
          icon="ellipsis"
          label={`${props.definition.title} panel actions`}
          // Header actions fade when the pointer leaves. Keep the trigger present while its portalled
          // menu owns pointer and focus.
          {...(open() ? { 'data-open': '' } : {})}
          onPress={toggle}
        />
      )}
    >
      {(menu) => (
        <>
          <Menu.Item context={menu} onSelect={props.actions.edit}>Edit</Menu.Item>
          <Menu.Separator />
          <Show when={!props.layout.collapsed()}>
            <Menu.Item context={menu} onSelect={props.actions.beginLayout}>Move / resize</Menu.Item>
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
          <Menu.Item context={menu} onSelect={props.actions.remove}>Remove from here</Menu.Item>
          <Menu.Item
            context={menu}
            tone="danger"
            closeOnSelect={confirmDelete.armed() === props.definition.id}
            onSelect={() => {
              if (confirmDelete.request(props.definition.id)) {
                void props.actions.delete().catch(props.actions.deleteFailed)
              }
            }}
          >
            {confirmDelete.armed() === props.definition.id ? 'Delete — press again' : 'Delete panel'}
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
          actions={chrome()}
          headProps={props.layout.collapsed() ? {} : { onPointerDown: props.layout.onBeginDrag }}
        />
      </Show>
      <Show when={!props.layout.collapsed()}>
        {handle('e')}
        {handle('s')}
        {handle('se')}
      </Show>
      <Show when={props.layout.keyboardActive()}>
        <div class="dash-caption" aria-hidden="true">{props.layout.announcement()}</div>
      </Show>
    </div>
  )
}
