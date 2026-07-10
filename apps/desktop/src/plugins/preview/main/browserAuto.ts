// Drivable browser — pure layer (docs/panes.md): CDP accessibility payloads → a compact AxNode
// tree with stable per-snapshot refs (e1, e2, …), and the ref book-keeping clicks/fills resolve
// against. The Playwright ARIA-snapshot model: agents reference refs, never CSS selectors. The
// Electron webContents/debugger glue lives in browserService.ts; this module tests under plain Node.

export type AxNode = {
  ref?: string // present when the node is actionable (has a backend DOM node)
  role: string
  name?: string
  value?: string
  children?: AxNode[]
}

// The slice of CDP Accessibility.getFullAXTree nodes we consume.
export type CdpAxNode = {
  nodeId: string
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string }
  childIds?: string[]
  parentId?: string
  backendDOMNodeId?: number
}

const STRUCTURAL_ROLES = new Set(['generic', 'none', 'InlineTextBox', 'LineBreak', 'StaticText'])

export type AxSnapshot = { tree: AxNode[]; refs: Map<string, number> } // ref → backendDOMNodeId

// Flat CDP list → tree. Ignored/anonymous structural nodes are flattened (children promoted) so
// the snapshot stays small enough to hand an agent; refs are assigned in traversal order to nodes
// that are actionable (backed by a DOM node) and meaningful (named or value-bearing).
export function buildAxTree(nodes: CdpAxNode[]): AxSnapshot {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const hasParent = new Set<string>()
  for (const n of nodes) for (const c of n.childIds ?? []) hasParent.add(c)
  const roots = nodes.filter((n) => !n.parentId && !hasParent.has(n.nodeId))

  const refs = new Map<string, number>()
  let counter = 0

  const visitChildren = (node: CdpAxNode): AxNode[] =>
    (node.childIds ?? []).flatMap((id) => {
      const child = byId.get(id)
      return child ? visit(child) : []
    })

  const visit = (node: CdpAxNode): AxNode[] => {
    const role = node.role?.value ?? 'unknown'
    const name = node.name?.value || undefined
    const value = node.value?.value != null && node.value.value !== '' ? String(node.value.value) : undefined
    // Flatten: ignored nodes and anonymous structure add noise, not signal.
    if (node.ignored || (STRUCTURAL_ROLES.has(role) && !name && !value)) return visitChildren(node)
    const out: AxNode = { role, ...(name ? { name } : {}), ...(value ? { value } : {}) }
    // Refs number in PRE-order (parent before children) — the reading order agents see.
    if (node.backendDOMNodeId != null && (name || value || !STRUCTURAL_ROLES.has(role))) {
      out.ref = `e${++counter}`
      refs.set(out.ref, node.backendDOMNodeId)
    }
    const children = visitChildren(node)
    if (children.length) out.children = children
    return [out]
  }

  return { tree: roots.flatMap(visit), refs }
}

// Resolve a ref from the LAST snapshot; anything else is stale by definition.
export function resolveRef(snapshot: AxSnapshot | null, ref: string): number {
  const backendNodeId = snapshot?.refs.get(ref)
  if (backendNodeId == null) throw new Error(`Stale or unknown ref '${ref}' — take a new browser_snapshot first.`)
  return backendNodeId
}

// Render the tree as the compact indented text agents read best (verne/Playwright shape).
export function renderAxTree(tree: AxNode[], depth = 0): string {
  const lines: string[] = []
  for (const node of tree) {
    const parts = [node.role, node.name ? JSON.stringify(node.name) : null, node.value ? `value=${JSON.stringify(node.value)}` : null, node.ref ? `[${node.ref}]` : null]
    lines.push(`${'  '.repeat(depth)}- ${parts.filter(Boolean).join(' ')}`)
    if (node.children) lines.push(renderAxTree(node.children, depth + 1))
  }
  return lines.join('\n')
}

// ERR_ABORTED (-3) on navigation is benign (redirects/SPA) — verne's documented gotcha.
export const isBenignNavError = (err: unknown): boolean => {
  const e = err as { errno?: number; code?: string; message?: string }
  return e?.errno === -3 || e?.code === 'ERR_ABORTED' || !!e?.message?.includes('ERR_ABORTED')
}

export const isAllowedBrowserUrl = (url: string): boolean => /^https?:\/\//i.test(url)

// The preview surface (WebContentsView) carries the old will-attach-webview restriction
// byte-for-byte: http(s) only AND no userinfo in the authority, so a configured preview URL like
// `http://localhost@evil.com` can't disguise a foreign host as localhost.
export const isAllowedPreviewUrl = (url: string): boolean => /^https?:\/\/[^@/?#]+(?::\d+)?(\/|$|\?|#)/.test(url)
