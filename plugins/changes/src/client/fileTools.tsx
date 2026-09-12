import { Show } from 'solid-js'
import { formatFileReference } from '@acorn/plugin-api/client'
import { ConfirmButton, Menu, RowActions } from '@acorn/plugin-api/ui'
import type { ChangesModel } from './changesModel'
import type { FileRow } from './model'

// The verbs on one row of the Changes list, behind the kit's per-row overflow menu. Its own node
// rather than markup inside the list, so the tree view can hang the same menu off a nested row
// instead of growing a second copy of it.
//
// The staging control is not in here. It is a checkbox on the row, because staging is the thing a
// reader does over and over on the way to a commit and a menu is one click too many for it; what is
// left is the two verbs you reach for once.
//
// Discard is a `ConfirmButton` rather than a `Menu.Item`: it cannot be undone, and an armed label is
// the prompt on every host, terminal included (docs/ui-design.md § The closed kit).
export function FileTools(props: { row: FileRow; model: ChangesModel }) {
  const row = () => props.row
  return (
    <RowActions ariaLabel={`Actions for ${row().path}`}>
      {(menu) => (
        <>
          <Show when={row().group === 'conflicted'}>
            {/* Git's own answer to "stage a conflict" is "mark it resolved", so the menu says the
                thing git means rather than the thing git does. */}
            <Menu.Item context={menu} onSelect={() => void props.model.stage([row().path])}>
              Mark resolved
            </Menu.Item>
          </Show>
          <Menu.Item
            context={menu}
            title="Add a file reference to the composer"
            onSelect={() => void props.model.sendRef(formatFileReference(row().path))}
          >
            Send to agent
          </Menu.Item>
          <ConfirmButton
            variant="bare"
            size="sm"
            label="Discard changes"
            tip="Discard changes"
            tipSub="Restore this file — cannot be undone"
            confirmLabel="Sure?"
            onConfirm={() => void props.model.discard(row().path, row().status === 'untracked')}
          >
            Discard
          </ConfirmButton>
        </>
      )}
    </RowActions>
  )
}
