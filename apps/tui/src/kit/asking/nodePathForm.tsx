/** @jsxImportSource @acorn/tui/jsx */
import { createSignal } from 'solid-js'
import type { NodePathFormProps } from '@acorn/client-core/features/workspaces/NodePathForm.tsx'
import { Input } from './fields'
import { Button } from './buttons'

/** The typed folder field, as the desktop draws it: Enter in the field or the button sends the path. */
export function NodePathForm(props: NodePathFormProps) {
  const [path, setPath] = createSignal(props.initial ?? '')
  const send = () => {
    const folder = path().trim()
    if (folder && !props.busy) void props.submit(folder).then((done) => done && setPath(''))
  }
  return (
    <box flexDirection="row" gap={1}>
      <Input
        label="Folder path on this Node"
        value={path()}
        placeholder="/absolute/path/on/node"
        onInput={setPath}
        onSubmit={send}
      />
      <Button disabled={props.busy || !path().trim()} onPress={send}>
        {props.action}
      </Button>
    </box>
  )
}
