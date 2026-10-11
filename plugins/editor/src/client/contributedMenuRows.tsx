import { For, Show } from 'solid-js'
import { contextMenuItems, fileMenuTarget, runContextMenuItem, type FileMenuTarget } from '@acorn/plugin-api/client'
import { Icon, Menu } from '@acorn/plugin-api/ui'
import { imageTypeForPath } from '../contract/imagePreview'

type MenuContext = Parameters<Parameters<typeof Menu>[0]['children']>[0]
type FileLocation = 'file.row' | 'document.tab'

/** The menu target for one of Editor's files. `readOnly` means Editor shows the file as a picture,
 *  not as text it can edit. */
export const editorMenuTarget = <L extends FileLocation>(
  location: L,
  {
    revision,
    ...fields
  }: {
    nodeId: string | null
    taskId: string
    projectId: string
    path: string
    directory: boolean
    revision?: string | undefined
  },
): FileMenuTarget<L> =>
  fileMenuTarget(location, {
    ...fields,
    ...(revision ? { revision } : {}),
    nodeId: fields.nodeId ?? '',
    ownerPluginId: 'editor',
    title: fields.path.slice(fields.path.lastIndexOf('/') + 1),
    readOnly: !fields.directory && !!imageTypeForPath(fields.path),
  })

/**
 * Other plugins' rows for a file or tab (docs/plugins/menus-and-markers.md § Context menus), drawn
 * after Editor's own rows in the same menu. `guard` is the owner's check that the menu's target is
 * still the file it opened on; a row runs only inside it.
 */
export function ContributedMenuRows(props: {
  context: MenuContext
  target: FileMenuTarget<'file.row'> | FileMenuTarget<'document.tab'>
  guard: (run: () => void) => void
}) {
  const rows = () => contextMenuItems(props.target.location, props.target)
  return (
    <Show when={rows().length}>
      <Menu.Separator />
      <For each={rows()}>
        {(row) => (
          <Menu.Item
            context={props.context}
            // No icon, no slot: an empty one indents the label past Editor's own rows.
            leading={row.icon ? <Icon name={row.icon} /> : undefined}
            onSelect={() => props.guard(() => runContextMenuItem(row, props.target))}
          >
            {row.label}
          </Menu.Item>
        )}
      </For>
    </Show>
  )
}
