/** @jsxImportSource @acorn/tui/jsx */
import { createResource, Show } from 'solid-js'
import type { Task } from '@acorn/client-core/infra/queries.ts'
import { setTerminalOpen } from '@acorn/client-core/features/tasks/tasks.ts'
import { Dynamic } from '../tree/renderer'
import { Line } from '../kit/cells'
import { Alert, Row, Rows } from '../kit/showing'
import { Modal, ModalBody } from '../kit/grouping'

/** Keep Terminal's session store and Agents' handoff client out of the first-frame graph. */
export function SessionsHost(props: { task: Task; onClose: () => void }) {
  const [component, { refetch }] = createResource(async () => (await import('./Sessions')).Sessions)
  const close = (): void => { setTerminalOpen(props.task.id, false); props.onClose() }
  return (
    <Show when={component()} fallback={
      <Modal onDismiss={close} title="Terminal sessions" size="wide">
        <ModalBody>
          <Show when={component.error} fallback={<Line role="muted">Opening terminal sessions…</Line>}>
            <Alert>{String(component.error)}</Alert>
            <Rows id="terminal.load.actions" items={[
              { key: 'retry', label: 'Retry' }, { key: 'close', label: 'Close' },
            ]} onActivate={(key) => key === 'retry' ? void refetch() : close()}>
              {(entry, item) => <Row item={item}>{entry.label}</Row>}
            </Rows>
          </Show>
        </ModalBody>
      </Modal>
    }>
      {(ready) => <Dynamic component={ready()} task={props.task} onClose={props.onClose} />}
    </Show>
  )
}
