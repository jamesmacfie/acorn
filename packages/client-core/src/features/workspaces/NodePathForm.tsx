import { createSignal } from 'solid-js'
import { Button, Input } from '../../kit/components/primitives'
import './projects.css'

/** The typed stand-in for the folder picker, where `pickNodeFolder` can't browse the Node's disk. The
 *  path is the Node's own, and the Node checks it. The field starts at `initial` and clears once `submit`
 *  resolves true. */
export function NodePathForm(props: {
  action: string
  busy?: boolean
  initial?: string
  submit: (path: string) => Promise<boolean>
}) {
  const [path, setPath] = createSignal(props.initial ?? '')
  return (
    <form
      class="project-add-path"
      onSubmit={(event) => {
        event.preventDefault()
        const folder = path().trim()
        if (folder) void props.submit(folder).then((done) => done && setPath(''))
      }}
    >
      <Input label="Folder path on this Node" value={path()} onInput={setPath} placeholder="/absolute/path/on/node" />
      <Button submit disabled={props.busy || !path().trim()}>
        {props.action}
      </Button>
    </form>
  )
}
