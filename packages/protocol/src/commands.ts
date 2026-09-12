import { z } from 'zod'

// The host-neutral half of the command contract: the vocabulary both clients spell the same way, and
// the bounds a loaded plugin's route answer is held to.
//
// What is here and what is not. This module holds words and wire facts — a kind, a scope, the numbers
// a search is allowed to ask for, and the shape of a result row. It holds no execution context, no
// outcome and no registry, because those carry host functions and Solid state and belong to the client
// (packages/client-core/src/host/registries/commands/commands.ts). Protocol is a pure sink
// (docs/architecture-overview.md § Package boundaries), so nothing here may reach for a client, a
// router or a plugin implementation type.
//
// Nothing in `plugin/contract.ts` reads these yet. A manifest command is still an action with a
// context-free verb, and it stays that way until a palette can render an interactive one
// (docs/command-palette-and-shortcuts.md).

/** What an entry in the command graph is. `action` is the only kind a manifest may declare today. */
export const COMMAND_KINDS = ['action', 'group', 'search', 'input', 'setting'] as const
export type CommandKind = (typeof COMMAND_KINDS)[number]

/**
 * Which identity a command needs before it can run, and how wide it reaches.
 *
 * `node` is the default and means "the node this session captured". `fleet` is the only one that fans
 * out, and it is opt-in for the reason docs/command-palette-and-shortcuts.md § What the palette refuses
 * gives: fanning out by default multiplies provider traffic, rate-limit pressure and partial errors.
 */
export const COMMAND_SCOPES = ['none', 'task', 'project', 'workspace', 'node', 'fleet'] as const
export type CommandScope = (typeof COMMAND_SCOPES)[number]
export const DEFAULT_COMMAND_SCOPE: CommandScope = 'node'

// ── What a search may ask for ─────────────────────────────────────────────────────────────────────
//
// Compiled providers may override the defaults, because their code is in this bundle and their author
// can see the cost. A manifest is held to the accepted range instead: a declared 5 ms debounce is a
// plugin spending somebody else's network on every keystroke.

export const DEFAULT_COMMAND_SEARCH_DEBOUNCE_MS = 250
export const MIN_COMMAND_SEARCH_DEBOUNCE_MS = 150
export const MAX_COMMAND_SEARCH_DEBOUNCE_MS = 1_000

export const DEFAULT_COMMAND_SEARCH_MIN_QUERY = 2
export const MAX_COMMAND_SEARCH_MIN_QUERY = 20

/** How much of a typed query travels to a provider. A palette field has no length limit of its own, so
 *  without this a pasted file becomes a query string; the host truncates rather than refuses, because a
 *  reader who pasted too much wants the first part searched, not an error. */
export const MAX_COMMAND_SEARCH_QUERY = 200

/** Rows the host will render from one response. Excess is truncated, not refused: a provider that
 *  answers 200 rows is verbose rather than hostile, and dropping the whole answer helps nobody. */
export const MAX_COMMAND_SEARCH_ITEMS = 50

/** A setting is a visible choice, so it needs at least two of them, and a list long enough to need
 *  scrolling is a page rather than a command (docs/command-palette-and-shortcuts.md § What the palette refuses). */
export const MIN_COMMAND_SETTING_OPTIONS = 2
export const MAX_COMMAND_SETTING_OPTIONS = 32

// ── The result row ────────────────────────────────────────────────────────────────────────────────

/**
 * One row a search answered with: display facts and identity, and nothing else.
 *
 * There is deliberately no action field, no route and no verb. A response is untrusted wire input, and
 * letting a row choose what happens when it is picked would make a changing server answer more
 * powerful than the manifest somebody reviewed (docs/command-palette-and-shortcuts.md § What the
 * palette refuses). The search command owns one static action; this is the fact it is handed.
 *
 * Unknown keys are stripped rather than kept, which is what makes that true in practice: a row that
 * ships an `action` field loses it here, before anything can read one.
 */
export const commandSearchItemSchema = z.object({
  // Unique within one response. The host namespaces it per node before rendering a fleet fan-out, so a
  // provider need not know about other nodes.
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  subtitle: z.string().min(1).max(300).optional(),
  // A Lucide name or a `brand:` id, resolved client-side (docs/ui-design.md § Icons), so it is
  // length-bounded rather than parsed against a vocabulary this package does not own.
  icon: z.string().min(1).max(80).optional(),
  badge: z.string().min(1).max(80).optional(),
  // The identity a closed action may need. Named fields rather than a free map, because these are the
  // three scopes the host already derives and can check against the session it captured.
  taskId: z.string().min(1).max(200).optional(),
  projectId: z.string().min(1).max(200).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  // The provider's own identifier for the thing — an issue key, a container id — for an action that
  // addresses it. A string the plugin's own route interprets, never a route, a URL or a verb.
  ref: z.string().min(1).max(300).optional(),
})

export type CommandSearchItem = z.infer<typeof commandSearchItemSchema>

/** One labelled choice a `setting` command offers. */
export const commandSettingOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  keywords: z.array(z.string().min(1).max(80)).max(16).optional(),
})

export type CommandSettingOption = z.infer<typeof commandSettingOptionSchema>

// ── What a plugin route may answer ────────────────────────────────────────────────────────────────

// Loose on the envelope, strict on the row. A newer node answering with a sibling key alongside
// `items` must not cost the reader every result, which is the same tolerance every other descriptor
// response keeps (./api.ts § the roster).
const commandSearchEnvelope = z.looseObject({ items: z.array(z.unknown()) })

/**
 * The rows of a search response the host may render: every malformed row dropped rather than failing
 * the whole answer, and the accepted set capped at `MAX_COMMAND_SEARCH_ITEMS`.
 *
 * A caller that wants to log the drops compares the length it got back with the length it sent in.
 */
export function acceptCommandSearchItems(body: unknown): CommandSearchItem[] {
  const envelope = commandSearchEnvelope.safeParse(body)
  if (!envelope.success) return []
  const accepted: CommandSearchItem[] = []
  for (const row of envelope.data.items) {
    if (accepted.length >= MAX_COMMAND_SEARCH_ITEMS) break
    const item = commandSearchItemSchema.safeParse(row)
    if (item.success) accepted.push(item.data)
  }
  return accepted
}

/** What a submit route answers: it worked, optionally with a row for the success action and a line to
 *  show. A failure uses the ordinary error envelope (./errors.ts) rather than `ok: false`, so there is
 *  one way for a route to fail. */
export const commandInputResultSchema = z.object({
  ok: z.literal(true),
  item: commandSearchItemSchema.optional(),
  message: z.string().min(1).max(500).optional(),
})

export type CommandInputResult = z.infer<typeof commandInputResultSchema>

/** What a setting's read and write routes both answer. The value has to name one of the options the
 *  manifest declared; the host checks that against its own copy rather than trusting the answer. */
export const commandSettingValueSchema = z.object({ value: z.string().min(1).max(200) })

export type CommandSettingValue = z.infer<typeof commandSettingValueSchema>
