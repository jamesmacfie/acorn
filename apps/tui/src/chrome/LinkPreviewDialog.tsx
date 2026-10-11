/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show } from 'solid-js'
import { CORE_LINK_PREVIEW_POINT } from '@acorn/protocol/extensionPoints.ts'
import {
  closeLinkPreview,
  linkPreviewProps,
  type LinkPreviewRequest,
} from '@acorn/client-core/host/linkPreview/linkPreview.ts'
import { pluginLabel } from '@acorn/client-core/host/plugins'
import { toast } from '@acorn/client-core/features/notifications'
import { Line } from '../kit/cells'
import { Modal, ModalActions, ModalBody } from '../kit/grouping'
import { Slot } from '../kit/host'
import { Button } from '../kit/asking'
import { openTerminalLink, resolveTerminalLink } from './link'
import type { ShellModel } from './model'

// The terminal's link preview: the same `core:link-preview` slot the desktop draws in a popover, in a
// dialog. It opens only from the link menu, because a terminal has no hover. The body is clipped to
// the rows the overlay layer has, so a long preview cannot push the dialog off the screen.
export default function LinkPreviewDialog(props: { request: LinkPreviewRequest; nodeId: string; model: ShellModel }) {
  const [by, setBy] = createSignal<string>()
  const open = (): void => {
    const url = props.request.url
    closeLinkPreview()
    const resolved = resolveTerminalLink({ nodeId: props.nodeId, kind: 'open', url }, props.model)
    // No in-app place claims it, and there is no browser to hand it to.
    if (resolved.destination.kind === 'refused') return toast(`Open in a browser: ${url}`)
    openTerminalLink(resolved, props.model)
  }
  return (
    <Modal title="Preview" size="md" onDismiss={closeLinkPreview}>
      <ModalBody>
        <box flexDirection="column" flexShrink={1} minHeight={0} overflow="hidden">
          <Slot
            point={CORE_LINK_PREVIEW_POINT}
            key={props.request.url}
            props={() => linkPreviewProps(props.request)}
            {...(props.request.scope.taskId ? { taskId: props.request.scope.taskId } : {})}
            projectId={props.request.scope.projectId ?? null}
            occupied={(occupied, pluginId) => setBy(occupied ? pluginId : undefined)}
          >
            <Show when={props.request.label}>
              {(label) => (
                <Line role="strong" wrap>
                  {label()}
                </Line>
              )}
            </Show>
            <Line role="muted" wrap>
              {props.request.url}
            </Line>
          </Slot>
        </box>
      </ModalBody>
      <ModalActions>
        <Show when={by()}>{(pluginId) => <Line role="muted">{`From ${pluginLabel(pluginId())}`}</Line>}</Show>
        <Button onPress={open}>Open</Button>
      </ModalActions>
    </Modal>
  )
}
