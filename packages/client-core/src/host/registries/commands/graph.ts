import { fuzzyScore } from '../../../kit/lib/fuzzy'
import {
  commandAvailable,
  commandHint,
  commandScopeSatisfied,
  commandTitle,
  DEFAULT_COMMAND_ORDER,
  type CommandContribution,
  type CommandExecutionContext,
} from './commands'

// The command graph: a flat registry read as a tree, once, for whoever is drawing
// (docs/command-palette-and-shortcuts.md).
//
// Pure and host-neutral. It takes a snapshot of contributions and answers with nodes; it renders
// nothing, fetches nothing and holds no state, which is what lets the desktop and the terminal share
// one set of transitions instead of reproducing each other's. `tools/arch/boundaries.test.ts` holds
// that line: nothing in this folder may reach a component.
//
// It is deliberately total. A registry can hold a duplicate id, a child whose parent was disposed
// first during a dev reload, a child naming a leaf as its parent, a plugin naming core's group, or a
// cycle. None of those may take the palette down, so each becomes a dropped node and one diagnostic,
// and everything else still draws.

/** Why a contribution did not make it into the tree. */
export type CommandGraphIssue =
  | 'duplicate-id'
  | 'missing-parent'
  | 'parent-not-group'
  | 'cross-owner-parent'
  | 'cycle'

export type CommandGraphDiagnostic = {
  /** The command that was dropped. */
  id: string
  issue: CommandGraphIssue
  message: string
}

export type CommandNode = {
  readonly id: string
  readonly command: CommandContribution
  readonly title: string
  readonly hint: string | undefined
  readonly parentId: string | undefined
  /** 0 at the top level. */
  readonly depth: number
  /** Titles from the top level down to and including this one. A renderer showing a breadcrumb as
   *  secondary text drops the last element, which is the row's own label. */
  readonly breadcrumb: readonly string[]
  /** This node and every ancestor pass their own gates. An unavailable ancestor makes its whole
   *  subtree unavailable, because a child of a group you cannot reach is not reachable either. */
  readonly available: boolean
  /** Available, flagged for the palette, and no ancestor hidden. What discovery lists. */
  readonly discoverable: boolean
  readonly children: readonly CommandNode[]
}

export type CommandGraph = {
  /** The top level, in sibling order: every node with no parent, discoverable or not. */
  readonly roots: readonly CommandNode[]
  readonly nodes: ReadonlyMap<string, CommandNode>
  readonly diagnostics: readonly CommandGraphDiagnostic[]
  /** What an empty root query shows: discoverable top-level nodes, in sibling order. */
  top(): readonly CommandNode[]
  /** A node's discoverable children, in sibling order. Empty for an id nothing registered. */
  children(id: string): readonly CommandNode[]
  /**
   * Root search: every discoverable node at any depth, ranked over its title, keywords, hint and
   * joined breadcrumb, so hierarchy reduces noise without making a command undiscoverable.
   *
   * A blank query is the empty root and answers `top()`, which is the rule the palette states rather
   * than a shortcut.
   */
  search(query: string): readonly CommandNode[]
  /**
   * The same search, with the scores it ranked on.
   *
   * The palette's root holds more than commands while the compatibility rows are still around, and
   * those rows are scored by the same `fuzzyScore`. A caller merging the two lists needs one number
   * per row or it cannot interleave them, and would have to fall back to showing commands as a block
   * — which is not what the flat list does today (./session.ts § the root projection).
   */
  ranked(query: string): readonly CommandNodeHit[]
}

/** One search hit: the node, and what it scored. */
export type CommandNodeHit = { readonly node: CommandNode; readonly score: number }

type Draft = {
  command: CommandContribution
  /** Registration order, the tie-break under `order`. */
  at: number
  parentId: string | undefined
  children: Draft[]
}

const orderOf = (command: CommandContribution): number => command.order ?? DEFAULT_COMMAND_ORDER

const bySibling = (a: Draft, b: Draft): number => orderOf(a.command) - orderOf(b.command) || a.at - b.at

/** Everything the root search indexes a node under. The breadcrumb is in here rather than only in the
 *  display, so typing a parent's word finds its children. */
const haystack = (node: CommandNode): readonly string[] => [
  node.title,
  ...(node.command.keywords ?? []),
  ...(node.hint ? [node.hint] : []),
  node.breadcrumb.join(' '),
]

const score = (query: string, node: CommandNode): number | null => {
  let best: number | null = null
  for (const text of haystack(node)) {
    const hit = fuzzyScore(query, text)
    if (hit !== null && (best === null || hit > best)) best = hit
  }
  return best
}

/**
 * Project a snapshot of contributions into a tree.
 *
 * Ownership is compared as stated: core's commands carry no owner and so are all one owner, which is
 * what lets a core group hold core children while refusing a plugin's.
 *
 * `context` is the identity a session captured, and passing it applies the scope gate: a command about
 * a task is unavailable in a session that opened over no task (./commands.ts § commandScopeSatisfied).
 * Omitted — a cheat sheet, a test, anything asking what exists rather than what can run now — leaves
 * every scope satisfied, because there is no world to hold them against.
 */
export function buildCommandGraph(
  commands: readonly CommandContribution[],
  context?: CommandExecutionContext,
): CommandGraph {
  const diagnostics: CommandGraphDiagnostic[] = []
  const drop = (id: string, issue: CommandGraphIssue, message: string): void => {
    diagnostics.push({ id, issue, message })
  }

  // ── Accept, one id each ─────────────────────────────────────────────────────────────────────────
  // First registration wins, matching the registry, which refuses the second outright. The graph is
  // handed a list rather than a registry — a loaded manifest is validated before any of it is
  // registered — so it has to make the same decision itself.
  const drafts = new Map<string, Draft>()
  for (const [at, command] of commands.entries()) {
    if (drafts.has(command.id)) {
      drop(command.id, 'duplicate-id', `two commands registered as '${command.id}'`)
      continue
    }
    drafts.set(command.id, { command, at, parentId: command.parentId, children: [] })
  }

  // ── Place each child under a parent it may actually have ────────────────────────────────────────
  const dropped = new Set<string>()
  for (const draft of drafts.values()) {
    const parentId = draft.parentId
    if (parentId === undefined) continue
    const parent = drafts.get(parentId)
    if (!parent) {
      // A parent disposed before its child, which is what a dev reload in the wrong order looks like.
      // Hidden rather than promoted to the top level: a stray row at the root is worse than a missing
      // one, because nobody can tell it is stray.
      drop(draft.command.id, 'missing-parent', `'${draft.command.id}' names an unregistered parent '${parentId}'`)
      dropped.add(draft.command.id)
      continue
    }
    if (parent.command.kind !== 'group') {
      drop(draft.command.id, 'parent-not-group', `'${draft.command.id}' names '${parentId}', which is not a group`)
      dropped.add(draft.command.id)
      continue
    }
    if ((parent.command.ownerId ?? null) !== (draft.command.ownerId ?? null)) {
      drop(
        draft.command.id,
        'cross-owner-parent',
        `'${draft.command.id}' names '${parentId}', which belongs to another contributor`,
      )
      dropped.add(draft.command.id)
      continue
    }
  }

  // ── Refuse a cycle ──────────────────────────────────────────────────────────────────────────────
  // Walking up from every node rather than colouring the graph: the chains are short, and the walk
  // names the command it closed the loop on, which is something an author can go and look at. The
  // rest of the ring is dropped by the settling pass below with no second message, because saying
  // "and this one too" three more times buries the line that named the fault.
  for (const draft of drafts.values()) {
    if (dropped.has(draft.command.id)) continue
    const seen = new Set<string>([draft.command.id])
    let at: Draft | undefined = draft
    while (at?.parentId !== undefined) {
      const parent: Draft | undefined = drafts.get(at.parentId)
      if (!parent || dropped.has(parent.command.id)) break
      if (seen.has(parent.command.id)) {
        drop(draft.command.id, 'cycle', `'${draft.command.id}' is inside a parent cycle`)
        dropped.add(draft.command.id)
        break
      }
      seen.add(parent.command.id)
      at = parent
    }
  }

  // A child of a dropped node is dropped too, and takes no diagnostic of its own: the one naming the
  // real fault is already recorded, and repeating it per descendant buries it.
  let settling = true
  while (settling) {
    settling = false
    for (const draft of drafts.values()) {
      if (dropped.has(draft.command.id) || draft.parentId === undefined) continue
      if (dropped.has(draft.parentId)) {
        dropped.add(draft.command.id)
        settling = true
      }
    }
  }

  const rootDrafts: Draft[] = []
  for (const draft of drafts.values()) {
    if (dropped.has(draft.command.id)) continue
    if (draft.parentId === undefined) rootDrafts.push(draft)
    else drafts.get(draft.parentId)!.children.push(draft)
  }

  // ── Walk it, resolving titles and inheriting the gates ──────────────────────────────────────────
  // What a parent passes down, rather than the parent itself: a child needs its ancestors' resolved
  // gates before it is built, and its parent needs the built children, so passing two booleans breaks
  // the knot that would otherwise need a mutable node.
  type Inherited = { available: boolean; discoverable: boolean }
  const nodes = new Map<string, CommandNode>()
  const build = (draft: Draft, depth: number, trail: readonly string[], inherited: Inherited): CommandNode => {
    const title = commandTitle(draft.command)
    const breadcrumb = [...trail, title]
    const available = inherited.available
      && commandAvailable(draft.command)
      && (context === undefined || commandScopeSatisfied(draft.command, context))
    const discoverable = available && inherited.discoverable && !!draft.command.palette
    const children = draft.children
      .sort(bySibling)
      .map((child) => build(child, depth + 1, breadcrumb, { available, discoverable }))
    const node: CommandNode = {
      id: draft.command.id,
      command: draft.command,
      title,
      hint: commandHint(draft.command),
      parentId: draft.parentId,
      depth,
      breadcrumb,
      available,
      discoverable,
      children,
    }
    nodes.set(node.id, node)
    return node
  }
  const roots = rootDrafts.sort(bySibling).map((draft) => build(draft, 0, [], { available: true, discoverable: true }))

  const discoverableChildren = (id: string): readonly CommandNode[] =>
    (nodes.get(id)?.children ?? []).filter((child) => child.discoverable)
  const top = (): readonly CommandNode[] => roots.filter((node) => node.discoverable)

  const ranked = (query: string): readonly CommandNodeHit[] => {
    const trimmed = query.trim()
    if (!trimmed) return top().map((node) => ({ node, score: 0 }))
    return [...nodes.values()]
      .filter((node) => node.discoverable)
      .map((node) => ({ node, score: score(trimmed, node) }))
      .filter((row): row is CommandNodeHit => row.score !== null)
      // Relevance first, then the sibling order the author stated, so two equal hits do not swap
      // places between renders.
      .sort((a, b) => b.score - a.score || orderOf(a.node.command) - orderOf(b.node.command))
  }

  return {
    roots,
    nodes,
    diagnostics,
    top,
    children: discoverableChildren,
    search: (query) => ranked(query).map((hit) => hit.node),
    ranked,
  }
}
