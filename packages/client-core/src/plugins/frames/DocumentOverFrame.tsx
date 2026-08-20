import { createSignal } from 'solid-js'
import type { PluginDocumentRegion } from '@acorn/protocol/api.ts'
import DocumentSurface from '../../editor/DocumentSurface'
import type { DocumentHandle, DocumentScope } from '../../editor/documentModel'
import PluginFrame from './PluginFrame'
import type { FrameBinding } from './broker'
import { SplitHandle } from '../../ui/primitives'
import { createSplitDrag } from '../../ui/split'

// The `document-over-frame` template: a host-owned editor above the plugin's own frame, with a
// host-owned drag handle between them (docs/third-party/monaco.md § document-over-frame, concretely).
//
// ┌──────────────────────────────────┐
// │ host document surface            │  host: Monaco, theme, workers, dirty state, ⌘S, view state
// ├──────────────────────────────────┤  host: this component's drag handle
// │ [picker] [Save] [Generate] [Run] │  the plugin's frame starts here
// │ results grid                     │
// └──────────────────────────────────┘
//
// The reason the host composes this rather than the plugin: the frame CSP has `frame-src 'none'`, so a
// plugin can never embed host content inside its own layout. The restriction binds the plugin, not the
// host. The host is free to place its editor and the plugin's iframe side by side in its own DOM, and
// that inversion is the whole shape of the design.
//
// What is not a region: the button bar. Look at what database's bar actually holds: a searchable
// saved-queries picker with per-row delete chips, a Generate button visible only when a model
// connection exists, an Execute button disabled on connection status. A host-drawn "action bar"
// descriptor stops being cheap immediately. The bar is common, not impossible, so it is the plugin's,
// drawn as the first row of its own frame region. That is the same bar the litmus test in
// docs/plugins.md states: a region is host-owned only when the sandbox cannot serve its content.
//
// The two regions share no DOM and no JavaScript realm. Everything between them goes through the host:
// the frame reaches the document through `bridge.document` (the accessor threaded below), and the host
// reaches the frame with a surface action when a chord lands in the editor.

export type DocumentOverFrameProps = {
  pluginId: string
  binding: FrameBinding
  hash: string
  region: PluginDocumentRegion
  scope: DocumentScope
}

// Matches the pixel height the compiled database pane opened at, so the move is not also a visual
// change. Not persisted, exactly as it was not before: the drag is a reading posture for the session,
// and a stored one would need a scope, an eviction rule and a prefs key for something nobody asked to
// keep. Add it when someone does.
const DEFAULT_DOCUMENT_HEIGHT = 200
const MIN_DOCUMENT_HEIGHT = 80
const MAX_DOCUMENT_FRACTION = 0.7

export default function DocumentOverFrame(props: DocumentOverFrameProps) {
  const [height, setHeight] = createSignal(DEFAULT_DOCUMENT_HEIGHT)
  // Held rather than passed down as a prop, because the two regions mount independently: the iframe can
  // connect its bridge before the editor has finished fetching its document. PluginFrame reads through
  // the accessor per call, so a frame that got there first still finds the document when it arrives.
  const [handle, setHandle] = createSignal<DocumentHandle | null>(null)

  // Snapshotted at pointer-down; null between drags so a keyboard nudge measures from the current
  // height rather than the last drag's start.
  let dragStartHeight: number | null = null
  // The hook owns the drag, the pointer-capture teardown this used to write by hand, and the
  // arrow/Home/End keys this splitter did not have at all.
  const drag = createSplitDrag({
    axis: 'y',
    label: 'Resize editor',
    onStart: () => { dragStartHeight = height() },
    onDelta: (deltaPx) =>
      setHeight(Math.min(Math.max((dragStartHeight ?? height()) + deltaPx, MIN_DOCUMENT_HEIGHT), window.innerHeight * MAX_DOCUMENT_FRACTION)),
    onCommit: () => { dragStartHeight = null },
  })

  return (
    <section class="pane document-over-frame">
      <div class="document-over-frame-document" style={{ height: `${height()}px` }}>
        <DocumentSurface
          pluginId={props.pluginId}
          surfaceId={props.binding.surface}
          nodeId={props.binding.nodeId}
          region={props.region}
          scope={props.scope}
          // The updater form, because a Solid setter given a bare value it can call would call it, and
          // a document handle is a bag of methods.
          onHandle={(next) => setHandle(() => next)}
        />
      </div>
      <SplitHandle axis="y" drag={drag} class="document-over-frame-split" />
      <div class="document-over-frame-frame">
        <PluginFrame binding={props.binding} hash={props.hash} document={handle} />
      </div>
    </section>
  )
}
