import { mountTree } from '@acorn/client-core/host/frames/sdk'
import { createNode, createText, insertNode, type RemoteNode } from '@acorn/client-core/host/frames/remoteRoot.ts'

// The tree bundle `pnpm dev:mobile` posts to the sandbox relay: one that draws, then tries every way out
// of a worker and says what happened (docs/mobile/phone-setup.md § Try the sandbox). It runs with no
// custody. Built by scripts/dev.mjs and served only by the dev server.

const line = (text: string): RemoteNode => {
  const node = createNode('Text')
  insertNode(node, createText(text))
  return node
}

const attempts = (probe: string): [string, () => Promise<unknown>][] => [
  ['fetch', () => fetch(`${probe}/fetch`)],
  [
    'websocket',
    () =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`${probe.replace('http', 'ws')}/socket`)
        socket.onopen = resolve
        socket.onerror = () => reject(new Error('refused'))
      }),
  ],
  ['import', () => import(/* @vite-ignore */ `${probe}/module.js`)],
]

mountTree({
  probe: (_bridge, mount) => {
    const { probe } = mount.props() as { probe: string }
    const pane = createNode('Pane')
    insertNode(pane, line('sandbox probe drew its tree'))
    insertNode(mount.root.node, pane)
    // Storage is per origin, so the databases of the phone app's own origin are none of this worker's.
    void indexedDB.databases().then((databases) => insertNode(pane, line(`indexeddb: ${databases.length} databases`)))
    for (const [name, attempt] of attempts(probe)) {
      // A way out that works says "reached"; one that fails says why. The probe server is the witness
      // that matters, because a failure here could be a network error rather than the policy.
      attempt().then(
        () => insertNode(pane, line(`${name}: reached`)),
        (error: unknown) =>
          insertNode(pane, line(`${name}: blocked (${error instanceof Error ? error.message : error})`)),
      )
    }
  },
})
