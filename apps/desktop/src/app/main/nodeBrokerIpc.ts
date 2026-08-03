import { ipcMain, type BrowserWindow } from 'electron'
import { nodeFetchRequestSchema } from '@acorn/protocol/broker.ts'
import type { WsClientFrame } from '@acorn/protocol/ws.ts'
import type { NodeBroker } from './nodeBroker'

// The IPC projection of the broker. Deliberately thin: every decision lives in nodeBroker.ts, which
// is Electron-free and therefore testable, and this file only validates and forwards.
//
// Requests from the renderer are Zod-parsed here rather than trusted. The renderer is our own code,
// but it is also the only part of the system that renders third-party content, so treating its
// messages as a trust boundary costs one parse per call and removes a whole class of "what if a
// compromised renderer asked for…" reasoning. In particular `path` must start with '/', which is what
// stops a request being aimed at a host other than the node.

export const NODE_FETCH = 'acorn:node-fetch'
export const NODE_ABORT = 'acorn:node-abort'
export const NODE_SEND = 'acorn:node-send'
export const NODE_FRAME = 'acorn:node-frame'
export const NODE_STATUS = 'acorn:node-status'
export const FLEET_LIST = 'acorn:fleet-list'

export function registerNodeBrokerIpc(broker: NodeBroker): () => void {
  ipcMain.handle(NODE_FETCH, async (_event, nodeId: unknown, raw: unknown) => {
    if (typeof nodeId !== 'string') throw new Error('nodeFetch: nodeId must be a string')
    const request = nodeFetchRequestSchema.parse(raw)
    return broker.fetch(nodeId, request)
  })

  ipcMain.on(NODE_ABORT, (_event, requestId: unknown) => {
    if (typeof requestId === 'string') broker.abort(requestId)
  })

  ipcMain.on(NODE_SEND, (_event, nodeId: unknown, raw: unknown) => {
    if (typeof nodeId !== 'string') return
    // Structural check only. The frame vocabulary lives in @acorn/protocol/ws.ts as TypeScript unions
    // rather than Zod schemas, and mirroring all eleven client frames here would be a second copy to
    // keep in step for no gain: the node validates its own inbound frames, and what main needs to
    // know is only that this is a channel-tagged object it can forward.
    if (!raw || typeof raw !== 'object' || typeof (raw as { channel?: unknown }).channel !== 'string') return
    broker.send(nodeId, raw as WsClientFrame)
  })

  ipcMain.handle(FLEET_LIST, () => ({ nodes: broker.list(), statuses: broker.statuses() }))

  return () => {
    ipcMain.removeHandler(NODE_FETCH)
    ipcMain.removeHandler(FLEET_LIST)
    ipcMain.removeAllListeners(NODE_ABORT)
    ipcMain.removeAllListeners(NODE_SEND)
  }
}

// Push channels. Held as a function of the window rather than a captured reference so a window
// replaced by crash recovery gets the new one, and a destroyed window is simply skipped.
export function brokerPushTargets(window: () => BrowserWindow | null) {
  const send = (channel: string, ...args: unknown[]): void => {
    const win = window()
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }
  return {
    frame: (nodeId: string, frame: unknown) => send(NODE_FRAME, nodeId, frame),
    status: (status: unknown) => send(NODE_STATUS, status),
  }
}
