// Disposable production-SDK bundle. Global diagnostic messages never carry host authority.
import { connect, mountTree, createText, createNode, setProperty, insertNode } from 'unit06-sdk'
const alive = new Map<string, any>()
const retired = new Map<string, any>()
const report = (value: unknown) => (globalThis as any).postMessage(value)
const result = async (call: () => Promise<unknown>) => {
  try { return { ok: true, body: await call() } }
  catch (error) { return { ok: false, code: (error as any).code, message: String(error) } }
}
// Delay is used only by the isolated startup fixture, never by the regular ownership baseline.
if ((globalThis as any).__ACORN_PROBE_DELAY__) {
  ;(globalThis as any).addEventListener('message', () => report({ phase: 'generic-listener' }))
  await new Promise((resolve) => setTimeout(resolve, (globalThis as any).__ACORN_PROBE_DELAY__))
}
// Awaited top-level use before mountTree must execute once on legacy hosts/SDKs and deny promptly on
// a repaired modern bootstrap, without needing tree:ready to break a dependency cycle.
const connecting = connect()
report({ phase: 'listening' })
const bridge: any = await connecting
  report({ phase: 'bootstrap', context: bridge.context, mode: bridge.treeBridgeMode })
  report({ phase: 'top-level', result: await result(() => bridge.api.get('/v1/p/audit/top-level')) })
  mountTree({ panel: (bridge: any, mount: any) => {
    const label = mount.props().label
    alive.set(label, bridge)
    const button = createNode('Button')
    setProperty(button, 'label', label)
    insertNode(button, createText(`${label}:${bridge.context.nodeId}`))
    insertNode(mount.root.node, button)
    mount.onUnmount(() => { alive.delete(label); retired.set(label, bridge); report({ phase: 'retired', label }) })
    void (async () => {
      report({ phase: 'mounted', label, context: bridge.context, mode: bridge.treeBridgeMode,
        api: await result(() => bridge.api.get('/v1/p/audit/read')),
        state: await result(() => bridge.state.get('value')),
        document: await result(() => bridge.document.read()) })
    })()
  } })
;(globalThis as any).addEventListener('message', (event: any) => {
  const command = event.data?.probe
  if (!command) return
  const bridge = (command.retired ? retired : alive).get(command.label)
  if (!bridge) return report({ phase: 'reply', id: command.id, result: { ok: false, code: 'missing' } })
  const op = () => command.op === 'read' ? bridge.document.read()
    : command.op === 'write' ? bridge.document.write(command.text)
    : command.op === 'navigate' ? bridge.ui.openUrl('https://example.test')
    : bridge.api.get(`/v1/p/audit/${command.op}`)
  void result(op).then((result) => report({ phase: 'reply', id: command.id, result }))
})
