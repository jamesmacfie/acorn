// ── Plumbing ─────────────────────────────────────────────────────────────────────────────────────
// The handshake, the bridge, and the tree channel, the same code `npm create acorn-plugin` writes,
// with two additions: a table of entries, so one bundle draws several trees, and `draw`, which draws a
// slot again from scratch when its data changes. The trees this plugin draws start at `ENTRIES` below.
//
// This bundle runs in a Web Worker: no DOM, no network, no `importScripts` after boot. Its only I/O is
// the ports the host transfers: a bootstrap bridge and the tree channel on the first message, then a
// bridge per mounted tree, scoped to that tree's task or project.

const PLUGIN_BRIDGE_VERSION = 1

let treePort = null
let nodeSeq = 0
const slots = new Map()

addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return
  if (event.data.acornBridge !== PLUGIN_BRIDGE_VERSION) return
  const bootstrap = event.ports[0]
  if (bootstrap) {
    bootstrap.onmessage = (message) => {
      if (message.data?.kind === 'ready') bootstrap.postMessage({ kind: 'connected' })
    }
    bootstrap.start?.()
  }
  treePort = event.ports[1]
  if (!treePort) return
  treePort.onmessage = (message) => onTreeMessage(message.data)
  treePort.start?.()
  treePort.postMessage({ kind: 'tree:ready', version: 1, entries: Object.keys(ENTRIES), scopedBridge: true })
})

/** One mounted tree's bridge: `get`, `post`, and `put` reach your own routes, and `ui` asks the host for
 *  one of its effects, such as `{ op: 'toast', title }`. Each returns a promise of the answer. */
function connectBridge(port) {
  let requestSeq = 0
  let closed = false
  const pending = new Map()
  port.onmessage = (event) => {
    const message = event.data
    if (closed || !message || typeof message !== 'object') return
    if (message.kind === 'ready') port.postMessage({ kind: 'connected' })
    const waiting = typeof message.id === 'number' ? pending.get(message.id) : undefined
    if (!waiting) return
    pending.delete(message.id)
    if (message.ok) waiting.resolve(message.body)
    else waiting.reject(new Error(`${message.error.code}: ${message.error.message}`))
  }
  port.start?.()
  const send = (request) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error('Bridge disconnected'))
      const id = ++requestSeq
      pending.set(id, { resolve, reject })
      port.postMessage({ ...request, id })
    })
  const api = (method) => (path, body) => send({ kind: 'api', method, path, ...(body === undefined ? {} : { body }) })
  return {
    get: api('GET'),
    post: api('POST'),
    put: api('PUT'),
    ui: (effect) => send({ kind: 'ui', ...effect }),
    close: () => {
      if (closed) return
      closed = true
      for (const waiting of pending.values()) waiting.reject(new Error('Bridge disconnected'))
      pending.clear()
      port.onmessage = null
      port.close()
    },
  }
}

function onTreeMessage(message) {
  if (!message || typeof message !== 'object') return
  switch (message.kind) {
    // A second mount for the same slot is a props update, not a new tree.
    case 'tree:mount':
      return mount(message.slot, message.entry, message.props, message.context, message.bridgePort)
    case 'tree:unmount':
      slots.get(message.slot)?.bridge.close()
      slots.delete(message.slot)
      return
    case 'tree:event':
      slots.get(message.slot)?.handlers.get(message.handler)?.(message.payload)
      return
    // Miss two of these and the host ends this worker and shows a placeholder in every tree it served.
    case 'tree:ping':
      treePort.postMessage({ kind: 'tree:pong' })
      return
  }
}

/** A node: the name of one of acorn's components, its props, and its children. A prop that's
 *  `undefined` is left out, because the host refuses a whole batch that holds one. */
function el(type, props, children) {
  const defined = Object.entries(props || {}).filter(([, value]) => value !== undefined)
  return { id: 'n' + ++nodeSeq, type, props: Object.fromEntries(defined), children: children || [] }
}

/** A run of text. Text is a node, never a prop. */
function text(value) {
  return el('#text', { value: String(value) })
}

function mount(slot, entry, props, context, bridgePort) {
  const previous = slots.get(slot)
  if (previous && bridgePort) previous.bridge.close()
  const bridge = bridgePort ? connectBridge(bridgePort) : previous?.bridge
  if (!bridge || !ENTRIES[entry]) {
    treePort.postMessage({ kind: 'tree:failed', slot, message: bridge ? `No entry named ${entry}` : 'No scoped bridge' })
    return
  }
  const mounted = previous ?? { entry, rootId: null, handlers: new Map(), handlerSeq: 0, requestSeq: 0 }
  Object.assign(mounted, { props: props || {}, context: context || previous?.context || {}, bridge })
  slots.set(slot, mounted)
  draw(slot)
}

/** Draws a slot's entry again and replaces what it drew before, in one batch the host applies whole. */
function draw(slot) {
  const mounted = slots.get(slot)
  if (!mounted) return
  // A function can't cross a port, so it crosses as an id the host quotes back. Only the kit's own
  // event names carry one: onPress, onChange, onSelect, and the rest.
  mounted.handlers.clear()
  const on = (handler) => {
    const id = ++mounted.handlerSeq
    mounted.handlers.set(id, handler)
    return { $handler: id }
  }
  // Asks the tree's owner to run one of the actions its extension point declares, such as `show`.
  const invoke = (name, payload) => {
    const id = ++mounted.requestSeq
    treePort.postMessage({ kind: 'tree:host-request', slot, id, op: 'owner.invoke', name, payload })
  }
  const { props, context, bridge } = mounted
  const tree = ENTRIES[mounted.entry]({ props, context, bridge, on, invoke, redraw: () => draw(slot) })
  const ops = mounted.rootId ? [{ op: 'remove', id: mounted.rootId }] : []
  treePort.postMessage({ kind: 'tree:batch', slot, ops: [...ops, { op: 'insert', parent: null, index: 0, node: tree }] })
  mounted.rootId = tree.id
}
// ── End of plumbing ──────────────────────────────────────────────────────────────────────────────

// ── The trees ──────────────────────────────────────────────────────────────────────────────────────

const API = '/v1/p/acme-tracker'
const TONES = { Todo: 'neutral', 'In progress': 'accent', 'In review': 'warn' }
const ICONS = { Todo: 'circle', 'In progress': 'circle-dot', 'In review': 'eye' }

/** Draws every mounted tree again, for data they share. */
function drawAll() {
  for (const slot of slots.keys()) draw(slot)
}

// The issues, read once from the Node half and shared by every tree this worker draws.
let issues = null
let loading = false
let selected = null
let sort = null

function loadIssues(bridge) {
  if (issues || loading) return
  loading = true
  bridge
    .get(`${API}/issues`)
    .then((body) => {
      issues = body.items
      selected ??= issues[0]?.id ?? null
    })
    .catch(() => {
      issues = []
    })
    .finally(() => {
      loading = false
      drawAll()
    })
}

const ENTRIES = {
  // #region source-list
  // The rail source's list. `collapsed` is true while the person has the list at icon width. Then each
  // row draws as its `collapsedIcon`, named by `label` in a tooltip, and the header goes.
  list({ props, bridge, on }) {
    loadIssues(bridge)
    if (!issues) return el('Text', { emphasis: 'muted' }, [text('Loading issues…')])
    const rows = issues.map((issue) =>
      el(
        'Row',
        {
          density: 'compact',
          meta: issue.key,
          selected: issue.id === selected,
          ...(props.collapsed ? { collapsedIcon: ICONS[issue.state], label: issue.title } : {}),
          onPress: on(() => {
            selected = issue.id
            drawAll()
          }),
        },
        [text(issue.title)],
      ),
    )
    return el('ListColumn', props.collapsed ? {} : { label: 'Issues' }, rows)
  },
  // #endregion

  // #region source-detail
  // The detail beside the list. The list and the detail share this worker, so the selection is a
  // variable they both read.
  detail({ bridge }) {
    loadIssues(bridge)
    const issue = issues?.find((candidate) => candidate.id === selected)
    if (!issue) return el('EmptyState', { title: 'Pick an issue' })
    return el('Stack', { gap: 'row' }, [
      el('Heading', { level: 2 }, [text(issue.title)]),
      el('Inline', { gap: 'inline' }, [
        el('Badge', { tone: TONES[issue.state] }, [text(issue.state)]),
        el('Text', { emphasis: 'muted' }, [text(issue.key)]),
      ]),
      el('Text', { wrap: true }, [text(issue.summary)]),
    ])
  },
  // #endregion

  // #region pane
  // The pane's two regions. The layout, `header-body-footer`, places them; the trees fill them.
  paneHeader({ bridge, on }) {
    loadIssues(bridge)
    const open = (issues ?? []).filter((issue) => issue.state !== 'In review').length
    return el('Inline', { gap: 'inline' }, [
      el('Text', { emphasis: 'strong' }, [text(issues ? `${open} open issues` : 'Loading…')]),
      el('Button', { size: 'sm', onPress: on(() => ((issues = null), loadIssues(bridge))) }, [text('Refresh')]),
    ])
  },
  pane({ bridge }) {
    loadIssues(bridge)
    return el('Table', {}, [
      el('TableRow', { head: true }, [
        el('TableHead', {}, [text('Issue')]),
        el('TableHead', {}, [text('Title')]),
        el('TableHead', {}, [text('State')]),
      ]),
      ...(issues ?? []).map((issue) =>
        el('TableRow', {}, [
          el('TableCell', {}, [text(issue.key)]),
          el('TableCell', {}, [text(issue.title)]),
          el('TableCell', {}, [text(issue.state)]),
        ]),
      ),
    ])
  },
  // #endregion

  // #region settings
  // A settings page. Each `SettingsSection` id matches a `sections` entry in the manifest, so search
  // can link to it. The host draws the plugin strip above it, with **Show in left rail**.
  settings({ bridge, on, redraw }) {
    if (sort === null) {
      sort = 'state'
      bridge.get(`${API}/sort`).then((body) => ((sort = body.value), redraw()))
    }
    return el('Stack', { gap: 'section' }, [
      el('SettingsSection', { id: 'account', label: 'Account', description: 'The Acme workspace this plugin reads.' }, [
        el('SettingRow', { label: 'Workspace' }, [el('Text', {}, [text('acme-demo')])]),
      ]),
      el('SettingsSection', { id: 'display', label: 'Display' }, [
        el('SettingRow', { label: 'Sort issues by', description: 'The palette command changes the same setting.' }, [
          el('Select', {
            label: 'Sort issues by',
            value: sort,
            options: [
              { value: 'state', label: 'State' },
              { value: 'key', label: 'Key' },
            ],
            onChange: on((value) => {
              sort = value
              issues = null
              bridge.put(`${API}/sort`, { value }).then(() => loadIssues(bridge))
              redraw()
            }),
          }),
        ]),
      ]),
    ])
  },
  // #endregion

  // #region panel
  // The reference panel. The host draws its frame and close button, and passes the issue key as
  // `item`.
  panel({ props, bridge }) {
    loadIssues(bridge)
    const issue = issues?.find((candidate) => candidate.key === props.item)
    if (!issues) return el('Text', { emphasis: 'muted' }, [text('Loading…')])
    if (!issue) return el('Text', { emphasis: 'muted' }, [text(`No issue ${props.item}`)])
    return el('Stack', { gap: 'row' }, [
      el('Badge', { tone: TONES[issue.state] }, [text(issue.state)]),
      el('Text', { emphasis: 'strong' }, [text(issue.title)]),
      el('Text', { wrap: true }, [text(issue.summary)]),
    ])
  },
  // #endregion
}
