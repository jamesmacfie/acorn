/** @jsxImportSource @acorn/tui/jsx */
import { createResource, Show } from 'solid-js'
import { Dynamic } from '../tree/renderer'
import { Line } from '../kit/cells'
import { Alert, Row, Rows } from '../kit/showing'
import { Modal, ModalBody } from '../kit/grouping'
import type { ShellModel } from './model'
import type { SetupStep } from './Setup'

/** Setup's mutation and project query graph is loaded only when the first-run route opens. */
export function SetupHost(props: { model: ShellModel; nodeId: string; initialStep: SetupStep; onClose: () => void }) {
  const [component, { refetch }] = createResource(async () => (await import('./Setup')).Setup)
  return (
    <Show when={component()} fallback={
      <Modal onDismiss={props.onClose} title="Set up acorn" size="wide">
        <ModalBody>
          <Show when={component.error} fallback={<Line role="muted">Opening setup…</Line>}>
            <Alert>{String(component.error)}</Alert>
            <Rows id="setup.load.actions" items={[{ key: 'retry', label: 'Retry' }, { key: 'close', label: 'Close' }]}
              onActivate={(key) => key === 'retry' ? void refetch() : props.onClose()}>
              {(entry, item) => <Row item={item}>{entry.label}</Row>}
            </Rows>
          </Show>
        </ModalBody>
      </Modal>
    }>
      {(ready) => <Dynamic component={ready()} model={props.model} nodeId={props.nodeId} initialStep={props.initialStep} onClose={props.onClose} />}
    </Show>
  )
}
