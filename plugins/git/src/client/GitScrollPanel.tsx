import { untrack, type JSX } from 'solid-js'
import { TabPanel } from '@acorn/plugin-api/ui'
import { createGitViewSignal } from './viewState'

/** Mount once per reading place so TabPanel's local restoration also belongs to that place. */
export function GitScrollPanel(props: {
  projectId: string
  name: string
  idPrefix: string
  id: string
  children: JSX.Element
}) {
  const [offset, setOffset] = createGitViewSignal(
    () => props.projectId,
    () => `scroll:${props.name}`,
    () => 0,
  )
  const initialOffset = untrack(offset)
  return (
    <TabPanel
      idPrefix={props.idPrefix}
      id={props.id}
      active={props.id}
      scrollOffset={initialOffset}
      onChange={setOffset}
    >
      {props.children}
    </TabPanel>
  )
}
