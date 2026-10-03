// Everything the API panel knows, held once per subject and read by both of its regions.
//
// The pane is a `list-detail` layout, so the request tree and the request being edited are two
// entries in this bundle that the host mounts side by side (docs/panes/layout.md § Layout model). They share
// the selection, the draft, the send result and the saved lists, and the shared thing has to outlive
// either of them.
//
// A compiled plugin's regions are components in the shell's realm and get this from the host, as a
// `model` on the pane contribution (client-core registries/paneModels.ts). A loaded plugin needs no
// such seam, and this file is why: both regions are entries in one bundle running in one worker, so
// module scope already is the shared thing. That is the whole of the loaded half — one `createRoot`
// keyed by the subject the host mounted.
//
// Equivalent host grants share live state. The latest inactive subject keeps its draft, without
// retaining bridges; per-region actions use that region's bridge and never borrow a sibling's lease.
import { createRoot, getOwner, onCleanup } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { createHttpClient } from './httpClient'
import { buildPanel } from './requestModel'
import { clearDraftRecovery, draftRecovery } from './draftRecovery'

export type Selection = { kind: 'saved'; id: string } | { kind: 'new' } | { kind: 'variables' }

export { groupByFolder } from './requestGroups'
export type { Group } from './requestGroups'

export type PanelSubject = {
  bridge: AcornBridge
  projectId: string
  projectName: string
  taskId?: string
  /** The rail row this surface was opened on, when it was opened by one. A later row click into the
   *  same mounted tree arrives as `bridge.onSelect` instead. */
  initialRequestId?: string
}

export type HttpPanelModel = ReturnType<typeof buildPanel>

const bridgeIds = new WeakMap<AcornBridge, number>()
let bridgeSequence = 0
const affinity = (bridge: AcornBridge): string => {
  if (bridge.context.authority) return bridge.context.authority
  let id = bridgeIds.get(bridge)
  if (id === undefined) { id = ++bridgeSequence; bridgeIds.set(bridge, id) }
  return `legacy-bridge:${id}`
}
const subjectKey = (subject: PanelSubject): string => JSON.stringify([subject.bridge.context.nodeId ?? null, affinity(subject.bridge), subject.projectId, subject.taskId ?? null])
type Held = { key: string; model: HttpPanelModel; views: WeakMap<AcornBridge, HttpPanelModel>; dispose(): void; bridges: Map<AcornBridge, { refs: number; detach: () => void }> }
const live = new Map<string, Held>()
let idle: Held | null = null

export function httpPanelModel(subject: PanelSubject): HttpPanelModel {
  const key = subjectKey(subject)
  let entry = live.get(key)
  const revived = !entry && idle?.key === key
  if (revived) { entry = idle!; idle = null }
  if (!entry) {
    idle?.dispose()
    idle = null
    const bridges: Held['bridges'] = new Map()
    bridges.set(subject.bridge, { refs: 0, detach: () => {} })
    const currentBridge = (): AcornBridge => {
      const current = bridges.keys().next().value as AcornBridge | undefined
      if (!current) throw new Error('this HTTP panel has no mounted bridge')
      return current
    }
    entry = createRoot((dispose) => {
      try {
        return { key, bridges, views: new WeakMap<AcornBridge, HttpPanelModel>(), model: buildPanel(subject, currentBridge, (bridge) => bridges.has(bridge), draftRecovery(key)), dispose }
      } catch (error) {
        bridges.clear()
        dispose()
        throw error
      }
    })
  }
  live.set(key, entry)
  const owner = entry
  let lease = owner.bridges.get(subject.bridge)
  if (!lease || !lease.refs) {
    const unselect = subject.bridge.onSelect(owner.model.requestSelection)
    const unaction = subject.bridge.onSurfaceAction((command) => { if (command === 'new-request') owner.model.startNew() })
    lease = { refs: 0, detach: () => { unselect(); unaction() } }
    owner.bridges.set(subject.bridge, lease)
  }
  lease.refs++
  if (revived) owner.model.refresh()
  const bridge = subject.bridge
  if (getOwner()) onCleanup(() => {
    const current = owner.bridges.get(bridge)
    if (!current || --current.refs > 0) return
    current.detach()
    owner.bridges.delete(bridge)
    owner.model.retireBridge(bridge)
    if (owner.bridges.size) return
    live.delete(key)
    if (idle && idle !== owner) idle.dispose()
    idle = owner
  })
  let view = owner.views.get(bridge)
  if (!view) {
    const origin = (): AcornBridge => {
      if (!owner.bridges.has(bridge)) throw new Error('this HTTP panel region was retired')
      return bridge
    }
    view = {
      ...owner.model,
      client: createHttpClient(() => origin().api, key, bridge.context.nodeId),
      persist: (draft) => owner.model.persist(draft, origin()),
      remove: (row) => owner.model.remove(row, origin()),
      fire: () => owner.model.fire(origin()),
      onSaveClick: () => owner.model.onSaveClick(origin()),
      copy: (text) => owner.model.copy(text, origin()),
      copyAsCurl: () => owner.model.copyAsCurl(origin()),
    }
    owner.views.set(bridge, view)
  }
  return view
}

/** A worker retains the latest inactive subject's model, without retaining a retired bridge. */
export const _resetHttpPanelModel = (): void => {
  for (const owner of live.values()) {
    for (const lease of owner.bridges.values()) lease.detach()
    owner.bridges.clear()
    owner.dispose()
  }
  live.clear()
  idle?.dispose()
  idle = null
  clearDraftRecovery()
}
