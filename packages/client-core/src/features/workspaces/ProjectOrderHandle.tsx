import { IconButton } from '../../kit/components/inputs/IconButton'
import { Menu } from '../../kit/components/overlays/Menu'
import type { Project } from '@acorn/protocol/api.ts'
import type { createProjectOrder } from './createProjectOrder'

export function ProjectOrderHandle(props: {
  project: Project
  order: ReturnType<typeof createProjectOrder>
  first: boolean
  last: boolean
}) {
  return (
    <span
      class="ws-project-reorder"
      data-project-id={props.project.id}
      data-dragging={props.order.dragId() === props.project.id ? '' : undefined}
      data-drop-position={props.order.dropTarget()?.id === props.project.id ? props.order.dropTarget()?.position : undefined}
      onPointerDown={(event) => props.order.begin(event, props.project.id)}
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        event.preventDefault()
        event.stopPropagation()
        props.order.shift(props.project.id, event.key === 'ArrowUp' ? -1 : 1)
      }}
    >
      <Menu
        ariaLabel={`Reorder ${props.project.name}`}
        trigger={({ open, toggle }) => (
          <IconButton
            icon="grip-vertical"
            label={`Reorder ${props.project.name}`}
            tip="Drag to reorder"
            tipSub="Or open the menu to move up or down."
            tipKey="Alt+↑/↓"
            disabled={props.order.busy() || (props.first && props.last)}
            opens="menu"
            expanded={open()}
            onPress={() => { if (!props.order.consumeClick(props.project.id)) toggle() }}
          />
        )}
      >
        {(menu) => (
          <>
            <Menu.Item context={menu} disabled={props.order.busy() || props.first} onSelect={() => props.order.shift(props.project.id, -1)}>Move up</Menu.Item>
            <Menu.Item context={menu} disabled={props.order.busy() || props.last} onSelect={() => props.order.shift(props.project.id, 1)}>Move down</Menu.Item>
          </>
        )}
      </Menu>
    </span>
  )
}
