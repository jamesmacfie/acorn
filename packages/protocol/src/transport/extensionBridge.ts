import { z } from 'zod'
import { MAX_AGENT_CONTEXT_BYTES } from '../agents/agentContext.ts'
import {
  browserPanelSourceId,
  type BrowserHandoff,
  type BrowserPanel,
  type BrowserPanelView,
} from '../plugin/handoffs.ts'
import {
  siteAssociationSchema,
  type ProjectSite,
  type SiteAddress,
  type SiteAssociation,
} from '../projects/siteAssociations.ts'
import type { DataSchema } from '../data/values/dataSchemas.ts'
import type { DataValue } from '../data/values/dataValues.ts'
import type { NodeProbeResult, NodeRecord, NodeStatus } from './broker.ts'

// The browser extension's native messaging contract: the identities a host registration allows, the
// frame limits, and the typed operations. The browser extension and the CLI's native host are both
// apps and may not import each other, so the contract lives here. docs/browser-extension/native-messaging.md
// owns it.
// Named for the extension: `browser` is a plugin's ID, and protocol modules named for a plugin are a
// closed list in tools/arch/boundaries.test.ts.

export const BROWSER_BRIDGE_PROTOCOL_VERSION = 1

export type BridgeBrowser = 'chrome' | 'firefox'

// Two host names, so a development session never replaces the host the standalone CLI installed.
export const BROWSER_BRIDGE_HOST = 'com.acorn.browser_bridge'
export const BROWSER_BRIDGE_DEV_HOST = 'com.acorn.browser_bridge_dev'

// The public half of the pinned key. Chrome derives an unpacked extension's ID from the manifest
// `key`, so every checkout loads as the same ID and matches the host allowlist without reinstalling.
// Nothing signs with the private half; an unpacked build never needs it.
export const CHROME_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxovQWXTCjsT0iNRL4br5PQ4+JG3wDwpMwFWS/d0H9eyOdElbYLPxtVs+BBd1E8DQLGjeXy9gQPrI0dIAhoSYkIARcmZwLyRriAcdeUCT+SnDQ7xTemPGYl39JfLG9MqiZ/zh+ng8SZZZv8KoTth+X5T/GGoSjsYn/KuccBOU/M4x6rJepTwFML/5Yqee30n1ynJ3e8q44tJ6TcMm556JgumUWFIM7E7P0gGQN2FXTDtgz1QFw0IGVP14yE5NzsUIEvel/ob+weMXAlLp/LrS7BaKQSDaDIt9tCuWRjA+n3hkr4592Yfo7KxD/0cm7s5/1fLAiLFqGiJALpHH7YpsiQIDAQAB'
export const CHROME_EXTENSION_ID = 'ciaaplnahgpccadenkacgipmhmpbddjo'
export const FIREFOX_EXTENSION_ID = 'extension@acorn.dev'

// The registration file a browser reads to find the host. `path` must be absolute: the browser
// starts it without a shell, so nothing on PATH is available.
export function nativeHostRegistration(browser: BridgeBrowser, name: string, path: string) {
  const base = { name, description: 'Acorn browser bridge', path, type: 'stdio' as const }
  return browser === 'chrome'
    ? { ...base, allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`] }
    : { ...base, allowed_extensions: [FIREFOX_EXTENSION_ID] }
}

// Both browsers refuse a single host-to-browser message over 1 MiB. A reply is split into chunks of
// this many UTF-16 units: each costs at most three UTF-8 bytes, or two for an escaped quote, so a
// chunk and its envelope stay under the limit.
export const NATIVE_REPLY_CHUNK_CHARS = 256 * 1024
// The agents plugin's limit on one attachment, and on how many one turn may carry.
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const TURN_MAX_ATTACHMENTS = 8
// An attachment crosses native messaging as base64: four characters for every three bytes.
const ATTACHMENT_MAX_BASE64_CHARS = 4 * Math.ceil(ATTACHMENT_MAX_BYTES / 3)
// The largest request frame the host accepts: one upload at the attachment limit, with room for its
// envelope. Every request the schema below accepts fits. A larger length header means the stream is
// corrupt or hostile, and the host closes rather than buffering it. Both browsers send far larger
// messages to a host (Chrome 64 MiB, Firefox 4 GiB), so a request is never split.
export const NATIVE_REQUEST_MAX_BYTES = 14 * 1024 * 1024
// The largest reply the extension reassembles from chunks before it gives up on that request.
export const NATIVE_REPLY_MAX_CHARS = 16 * 1024 * 1024

// The most conversation events one `session.read` asks for. A page folds tool updates and drops the
// bulky fields before it leaves the host, so a full page stays far below NATIVE_REPLY_MAX_CHARS.
const SESSION_READ_MAX_EVENTS = 500
// The longest message the sidebar may send.
export const TURN_TEXT_MAX_CHARS = 60_000
// Captured page context a turn may carry: a page link or selected text each make one context part.
// The Node refuses more than MAX_AGENT_CONTEXT_BYTES of context content in one turn.
export const TURN_MAX_CONTEXTS = 8

const requestId = z.string().min(1).max(64)
const nodeId = z.string().min(1).max(128)
const rowId = z.string().min(1).max(128)
// The agents routes' own bounds on an idempotency key.
const operationKey = z.string().min(8).max(200)
const envelope = { v: z.literal(BROWSER_BRIDGE_PROTOCOL_VERSION), id: requestId }

// The parts of an agents plugin turn the sidebar sends, in that plugin's shape (`AgentInputPart`), so
// the host passes them on unchanged. Captured page context is a `context` part, which the Node hands
// the agent inside an escaped block, so page text can't read as the person's own words. A screenshot
// is an `image` part naming an attachment this task already holds.
const bridgeInputPartSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string().min(1).max(TURN_TEXT_MAX_CHARS) }),
  z.strictObject({
    type: z.literal('context'),
    contextId: z.string().min(1).max(200),
    label: z.string().min(1).max(500),
    content: z.string().min(1),
    source: z.literal('browser-extension'),
    resourceId: z.string().max(1_000).optional(),
    capturedAt: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('image'),
    attachmentId: rowId,
    alt: z.string().max(1_000).optional(),
  }),
])
export type BridgeInputPart = z.infer<typeof bridgeInputPartSchema>

const turnInputSchema = z
  .array(bridgeInputPartSchema)
  .min(1)
  .refine((input) => input.filter((part) => part.type === 'text').length <= 1, 'One text part at most.')
  .refine((input) => input.filter((part) => part.type === 'context').length <= TURN_MAX_CONTEXTS, 'Too many contexts.')
  // In characters, which is never more than the Node's byte count. It keeps the frame bounded: a
  // character costs at most six bytes as escaped JSON.
  .refine(
    (input) =>
      input.reduce((total, part) => total + (part.type === 'context' ? part.content.length : 0), 0) <=
      MAX_AGENT_CONTEXT_BYTES,
    'Too much context.',
  )
  .refine(
    (input) => input.filter((part) => part.type === 'image').length <= TURN_MAX_ATTACHMENTS,
    'Too many attachments.',
  )

// The answer to an agent's request, in the agents plugin's two shapes. A button sends the option's
// `id`. A form sends each question's answer by option label, or the typed text, because labels are
// what both harnesses record as what the person said. The Node checks a button against the options it
// offered, and caps the whole answer at 256 KiB.
const REQUEST_ANSWER_MAX_CHARS = 60_000
const requestResolutionSchema = z.union([
  z.strictObject({ optionId: z.string().min(1).max(200) }),
  z.strictObject({
    answers: z
      .record(
        z.string().min(1).max(200),
        z.union([z.string().max(REQUEST_ANSWER_MAX_CHARS), z.array(z.string().min(1).max(1_000)).max(100)]),
      )
      .refine((answers) => Object.keys(answers).length <= 50, 'Too many answers.'),
  }),
])
export type BridgeRequestResolution = z.infer<typeof requestResolutionSchema>

const handoffTarget = {
  pluginId: z.string().min(1).max(64),
  handoffId: z.string().min(1).max(64),
  url: z.string().url().max(2048),
}

export const bridgeRequestSchema = z.discriminatedUnion('op', [
  z.strictObject({ ...envelope, op: z.literal('nodes.list') }),
  z.strictObject({ ...envelope, op: z.literal('node.probe'), endpoint: z.string().url().max(2048) }),
  // The Node this computer's data root holds, the one `acorn` itself attaches to, kept as the probe
  // `node.pair` or `node.ask` completes. Its certificate comes from the Node's own files, so there are
  // no words to compare.
  z.strictObject({ ...envelope, op: z.literal('node.local') }),
  // Pairing by approval, for that local probe only (docs/api-reference/transport.md § Pairing by
  // approval). The host asks the Node and keeps the secret. The sidebar gets the phrase the owner's
  // dialog shows, then calls `node.collect` until the owner answers.
  z.strictObject({ ...envelope, op: z.literal('node.ask') }),
  z.strictObject({ ...envelope, op: z.literal('node.collect'), label: z.string().trim().min(1).max(120) }),
  // No endpoint or fingerprint: pairing completes the probe the person just confirmed.
  z.strictObject({
    ...envelope,
    op: z.literal('node.pair'),
    code: z.string().trim().min(1).max(256),
    label: z.string().trim().min(1).max(120),
  }),
  z.strictObject({ ...envelope, op: z.literal('node.select'), nodeId: nodeId.nullable() }),
  z.strictObject({ ...envelope, op: z.literal('node.forget'), nodeId }),
  // Bound to the node it was asked of. The host refuses it once that node is no longer selected.
  z.strictObject({ ...envelope, op: z.literal('projects.list'), nodeId }),
  z.strictObject({ ...envelope, op: z.literal('tasks.list'), nodeId, projectId: rowId }),
  // Every active task's page addresses, so the browser matches the page to its task itself and no
  // page address goes to the Node for it (docs/browser-extension/task-pages.md).
  z.strictObject({ ...envelope, op: z.literal('tasks.pages'), nodeId }),
  // The rows of the desktop's New picker. `refresh` asks the Node to check its harnesses again first.
  z.strictObject({ ...envelope, op: z.literal('agents.choices'), nodeId, refresh: z.boolean().optional() }),
  // One task's sessions, or every task's in one workspace.
  z
    .strictObject({
      ...envelope,
      op: z.literal('sessions.list'),
      nodeId,
      taskId: rowId.optional(),
      workspaceId: rowId.optional(),
    })
    .refine(
      (request) => (request.taskId === undefined) !== (request.workspaceId === undefined),
      'Name a task or a workspace.',
    ),
  z.strictObject({
    ...envelope,
    op: z.literal('session.read'),
    nodeId,
    sessionId: rowId,
    afterSeq: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(SESSION_READ_MAX_EVENTS),
  }),
  // Writes carry the key the sidebar keeps with its draft, so an explicit retry can't make a second
  // session or turn. The host checks the selection before a write and never after: once sent, its
  // outcome is reported whatever was selected since.
  z.strictObject({
    ...envelope,
    op: z.literal('session.create'),
    nodeId,
    taskId: rowId,
    providerId: z.string().min(1).max(100),
    profileId: z.string().min(1).max(100),
    // A choice's custom agent, or one of the harness's named logins, in the agents plugin's account
    // name grammar. The Node checks both exist.
    customAgentId: rowId.optional(),
    account: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
      .optional(),
    key: operationKey,
  }),
  z.strictObject({
    ...envelope,
    op: z.literal('turn.submit'),
    nodeId,
    sessionId: rowId,
    input: turnInputSchema,
    key: operationKey,
  }),
  // Archives a conversation, as the desktop's Archive does. The Node keeps it, out of every list.
  z.strictObject({ ...envelope, op: z.literal('session.archive'), nodeId, sessionId: rowId, key: operationKey }),
  // Stops the conversation's running turn, as the desktop's Stop does. The next read shows the stop.
  z.strictObject({ ...envelope, op: z.literal('session.cancel'), nodeId, sessionId: rowId, key: operationKey }),
  // Answers one request the agent is waiting on. `requestId` is the agents plugin's provider request
  // ID. The key is kept by the sidebar for that request and answer only, never stored, so an answer is
  // sent again only when the person presses it again.
  z.strictObject({
    ...envelope,
    op: z.literal('request.resolve'),
    nodeId,
    sessionId: rowId,
    requestId: z.string().min(1).max(200),
    resolution: requestResolutionSchema,
    key: operationKey,
  }),
  // Every request an agent is waiting on across the Node, for the toolbar badge. The browser matches
  // them to the page's projects itself, so no page address goes with it
  // (docs/browser-extension/notifications.md).
  z.strictObject({ ...envelope, op: z.literal('requests.pending'), nodeId }),
  // Draft attachments are the agents plugin's, scoped to a task. Each operation names that task, and
  // the host refuses an attachment that belongs to another. The upload carries no key: the Node keeps
  // one row per task and content, so sending the same bytes again answers with the same attachment.
  z.strictObject({
    ...envelope,
    op: z.literal('attachment.upload'),
    nodeId,
    taskId: rowId,
    filename: z.string().min(1).max(200),
    mediaType: z.enum(['image/png', 'image/jpeg']),
    data: z.string().min(1).max(ATTACHMENT_MAX_BASE64_CHARS),
  }),
  z.strictObject({ ...envelope, op: z.literal('attachment.read'), nodeId, taskId: rowId, attachmentId: rowId }),
  // The Node deletes only an attachment no turn has sent, and answers `removed: false` for one a turn has.
  z.strictObject({ ...envelope, op: z.literal('attachment.delete'), nodeId, taskId: rowId, attachmentId: rowId }),
  // Browser handoffs (docs/browser-extension/handoffs.md). The page address is the only thing the
  // browser supplies; the host matches it against the handoff's own patterns and calls only the route
  // the Node declared for that handoff.
  z.strictObject({ ...envelope, op: z.literal('handoffs.list'), nodeId }),
  z.strictObject({ ...envelope, op: z.literal('handoff.resolve'), nodeId, ...handoffTarget }),
  // Resolves the page again and creates from that answer, so the task seed never comes from the browser.
  // `identifier` and `connectionId` name which of the resolved items the person chose.
  z.strictObject({
    ...envelope,
    op: z.literal('handoff.create'),
    nodeId,
    ...handoffTarget,
    identifier: z.string().min(1).max(300),
    connectionId: rowId,
    projectId: rowId,
    key: operationKey,
  }),
  // Project site associations (docs/browser-extension/project-sites.md). The list is read whole, so the
  // sidebar matches pages itself and sends no address for it. Adding or removing one association reads
  // the project's list fresh and writes it back, so another client's change since isn't lost.
  z.strictObject({ ...envelope, op: z.literal('sites.list'), nodeId }),
  z.strictObject({ ...envelope, op: z.literal('site.add'), nodeId, projectId: rowId, site: siteAssociationSchema }),
  z.strictObject({ ...envelope, op: z.literal('site.remove'), nodeId, projectId: rowId, site: siteAssociationSchema }),
  // Workflows (docs/browser-extension/workflows.md). The list is what a task in the project can run.
  // A start carries its key like any other write, and the Node checks the values against the
  // definition's own inputs. A run's steps name the task they belong to, so the host can find each
  // step's conversation among that task's sessions.
  z.strictObject({ ...envelope, op: z.literal('workflows.list'), nodeId, projectId: rowId }),
  z.strictObject({
    ...envelope,
    op: z.literal('workflow.start'),
    nodeId,
    taskId: rowId,
    defId: z.string().min(1).max(256),
    inputs: z.record(z.string().min(1).max(200), z.json()).optional(),
    key: operationKey,
  }),
  z.strictObject({ ...envelope, op: z.literal('workflow.runs'), nodeId, taskId: rowId }),
  z.strictObject({ ...envelope, op: z.literal('workflow.steps'), nodeId, taskId: rowId, runId: rowId }),
  // A plugin's sidebar panel for one task (docs/browser-extension/plugin-panels.md). The host finds the
  // panel's route in the Node's discovery, so the browser names only the plugin, the task, and the log
  // source the person picked.
  z.strictObject({
    ...envelope,
    op: z.literal('plugin.panel'),
    nodeId,
    pluginId: rowId,
    taskId: rowId,
    source: browserPanelSourceId.optional(),
  }),
])
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>
export type BridgeOperation = BridgeRequest['op']

export type BridgeProject = { id: string; name: string; path: string | null; hidden: boolean; workspaceId: string }
// A workspace, the group of projects Home's task list shows one of at a time.
export type BridgeWorkspace = { id: string; name: string }
export type BridgeNodes = { nodes: NodeRecord[]; activeNodeId: string | null; status: NodeStatus | null }

type BridgeTask = { id: string; title: string; branch: string | null }

// An address a task is known by, in the project sites' grammar: an exact origin and a path prefix
// matched by whole segments, so a pull request's address covers its tabs and one at `/` covers the
// origin. `source` is the plugin or provider that knows the address, such as `github` or `linear`.
// `status` is set on an address a plugin published for the task, such as its local stack's app.
export type BridgeTaskPage = SiteAddress & { source: string; status?: BridgePageStatus }
// What a plugin says answers at an address it published, and its state, read together as one line
// ("Runn stack running"), with the state's tone.
type BridgePageStatus = { label: string; state: string; tone: 'ok' | 'warn' | 'bad' }
// An active task with the addresses it is known by, which may be none.
export type BridgePageTask = BridgeTask & { projectId: string; pages: BridgeTaskPage[] }

// One row of the desktop's New picker: a harness, one of its named logins, or a custom agent on it,
// in the agents plugin's words (its `newSessionChoices`). `label` is the full name, for search and
// screen readers; `text` is what the row shows, without an account its `accountIcon` stands for.
// `glyph` is a Lucide name or a `brand:` mark. A row that can't start says why in `description`.
export type BridgeAgentChoice = {
  providerId: string
  profileId: string
  customAgentId: string | null
  account: string | null
  label: string
  text: string
  description: string
  glyph: string | null
  accountIcon: string | null
  available: boolean
}

// The fields of the agents plugin's session row the sidebar draws. `runtimeState` and `attention`
// carry that plugin's values unchanged.
export type BridgeAgentSession = {
  id: string
  taskId: string
  title: string
  providerId: string
  profileId: string
  // The model and its reasoning effort as the desktop's rows write them, such as `Opus · High`. Null
  // until the provider reports a model.
  model: string | null
  kind: string
  // A chat started from a line of a diff.
  inline: boolean
  runtimeState: string
  attention: string
  lastEventSeq: number
  archivedAt: number | null
  updatedAt: number
}

// What the sidebar draws of one agent event: the session's own messages, its tool calls, and its
// errors. The host keeps the agents plugin's record identity and drops everything else, including a
// tool's input and output, which a summary never shows and which can be megabytes.
// An attachment a turn sent: a screenshot is an `image`, anything else a plain attachment.
export type BridgeAttachmentRef = { id: string; image: boolean; name: string | null }

export type BridgeConversationEvent =
  // `attachments` lists what the person's turn sent. When it's present, the text no longer carries the
  // `[Attachment: <id>]` lines that name them for the agent. `workflow` marks a workflow step's prompt.
  | { type: 'user_message'; text: string; attachments?: BridgeAttachmentRef[]; workflow?: true }
  | { type: 'assistant_message'; text: string; messageId?: string; append?: boolean }
  // `title` and `status` absent mean unchanged, as on the agents plugin's tool call.
  | { type: 'tool'; toolId: string; title?: string; status?: string }
  | { type: 'error'; message: string }

export type BridgeConversationRecord = {
  id: string
  seq: number
  turnId: string | null
  createdAt: number
  // Set when the Node folded later updates of this tool call into it: the last seq it absorbed.
  foldedThroughSeq?: number
  event: BridgeConversationEvent
}

// A request the agent is waiting on, or one that recently settled, narrowed from the agents plugin's
// request row (`AgentRequest`) to what a person needs to answer it.
export type BridgeAgentRequest = {
  // The provider's request ID, which the resolve route takes.
  requestId: string
  kind: string
  status: 'pending' | 'resolving' | 'resolved' | 'expired'
  title: string
  detail: string | null
  // Buttons. `reject` marks a refusal.
  options: { id: string; label: string; reject: boolean }[]
  // A form. A question with no options takes typed text.
  questions: {
    id: string
    header: string | null
    prompt: string
    options: { label: string; description: string | null }[]
    multiple: boolean
    secret: boolean
  }[]
  // App access, in the agents plugin's own words: the app, what each scope means, and any warning.
  approval: { target: string; scopeNote: string; warning: string | null } | null
  // Once settled by a button, that button's label. A form's answers stay on the Node: some are secret.
  answer: string | null
  // What happened after the answer, when the provider keeps a grant Acorn can't see.
  sentNote: string | null
  // Why the sidebar can't answer this request, or null when it can.
  unsupported: string | null
}

// A request an agent is waiting on, placed in its project and task. The badge counts these and the
// sidebar lists them; neither needs the request's choices until its conversation opens.
export type BridgePendingRequest = {
  requestId: string
  sessionId: string
  taskId: string
  projectId: string
  kind: string
  title: string
  taskTitle: string
}

export type BridgeSessionRead = {
  nodeId: string
  sessionId: string
  session: BridgeAgentSession
  records: BridgeConversationRecord[]
  // The furthest seq the page covered, counting the events the host left out. The next read starts
  // here.
  reach: number
  // Turns accepted but not yet sent to the agent. Their message joins the conversation at dispatch.
  queued: { id: string; text: string; attachments: BridgeAttachmentRef[] }[]
  // Every request still waiting, oldest first, then the few that settled most recently, so a request
  // answered elsewhere reads as settled rather than vanishing.
  requests: BridgeAgentRequest[]
}

// The agents plugin's attachment row.
export type BridgeAttachment = { id: string; taskId: string; filename: string; mediaType: string; byteSize: number }

// A plugin's site button, as discovery advertises it, without the route behind it: only the host calls
// that, and only for this handoff.
export type BridgeHandoff = Omit<BrowserHandoff, 'resolve'>

// A plugin's sidebar panel, as discovery advertises it, without its route: only the host calls that.
export type BridgePanel = Omit<BrowserPanel, 'route'>

// One item a handoff resolved, with what the sidebar needs to place it: its projects by name, and the
// active tasks already linked to it. The task seed stays in the host.
export type BridgeHandoffItem = {
  identifier: string
  url: string
  title: string
  connection: { id: string; label: string }
  projects: { id: string; name: string }[]
  linkedTasks: { id: string; title: string; projectId: string }[]
  context: { label: string; content: string } | null
}

// A workflow a task can run, from the workflows plugin's merged definition list, with the inputs it
// asks for in that plugin's shape (`WorkflowInput`).
export type BridgeWorkflow = {
  id: string
  name: string
  inputs: {
    name: string
    label?: string
    description?: string
    required?: boolean
    default?: DataValue
    schema?: DataSchema
  }[]
}
// A task's workflow run, and one of its steps, narrowed from the workflows plugin's rows. `status`
// carries that plugin's values unchanged. A step's `session` is the agent conversation it ran, once
// the step has one.
export type BridgeWorkflowRun = { id: string; name: string; status: string; createdAt: number; updatedAt: number }
export type BridgeWorkflowStep = {
  id: string
  name: string
  status: string
  createdAt: number
  updatedAt: number
  session: BridgeAgentSession | null
}

export type BridgeResults = {
  'nodes.list': BridgeNodes
  'node.probe': NodeProbeResult
  // Null when no Node holds this computer's data root.
  'node.local': (NodeProbeResult & { nodeId: string }) | null
  'node.pair': NodeRecord
  'node.ask': { phrase: string }
  // Null while the owner hasn't answered. A denial or an expiry is a `pairing_failed` failure.
  'node.collect': NodeRecord | null
  'node.select': BridgeNodes
  'node.forget': BridgeNodes
  'projects.list': { nodeId: string; projects: BridgeProject[]; workspaces: BridgeWorkspace[] }
  'tasks.list': { nodeId: string; projectId: string; tasks: BridgeTask[] }
  'tasks.pages': { nodeId: string; tasks: BridgePageTask[] }
  'agents.choices': { nodeId: string; choices: BridgeAgentChoice[] }
  'sessions.list': { nodeId: string; sessions: BridgeAgentSession[] } & ({ taskId: string } | { workspaceId: string })
  'session.read': BridgeSessionRead
  'session.create': { nodeId: string; session: BridgeAgentSession }
  'turn.submit': { nodeId: string; sessionId: string; turnId: string }
  'session.archive': { nodeId: string; sessionId: string }
  'session.cancel': { nodeId: string; sessionId: string }
  // The request as the Node holds it after the answer. One already settled comes back unchanged.
  'request.resolve': { nodeId: string; sessionId: string; request: BridgeAgentRequest }
  // Oldest first. Only active tasks' requests: an archived task has no conversation to open.
  'requests.pending': { nodeId: string; requests: BridgePendingRequest[] }
  'attachment.upload': { nodeId: string; taskId: string; attachment: BridgeAttachment }
  // `data` is the content as base64, or null when it isn't an image or passes ATTACHMENT_MAX_BYTES.
  'attachment.read': { nodeId: string; taskId: string; attachment: BridgeAttachment; data: string | null }
  'attachment.delete': { nodeId: string; taskId: string; attachmentId: string; removed: boolean }
  'handoffs.list': { nodeId: string; handoffs: BridgeHandoff[]; panels: BridgePanel[] }
  'handoff.resolve': { nodeId: string; url: string; items: BridgeHandoffItem[] }
  // `created` is false when an active task in that project was already linked, which is answered instead.
  'handoff.create': { nodeId: string; task: BridgeTask & { projectId: string }; created: boolean }
  'sites.list': { nodeId: string; sites: ProjectSite[] }
  'site.add': { nodeId: string; projectId: string; sites: SiteAssociation[] }
  'site.remove': { nodeId: string; projectId: string; sites: SiteAssociation[] }
  'workflows.list': { nodeId: string; projectId: string; workflows: BridgeWorkflow[] }
  'workflow.start': { nodeId: string; taskId: string; runId: string }
  // Newest first.
  'workflow.runs': { nodeId: string; taskId: string; runs: BridgeWorkflowRun[] }
  'workflow.steps': { nodeId: string; runId: string; steps: BridgeWorkflowStep[] }
  // Null when the plugin declares no panel, or has none for this task.
  'plugin.panel': { nodeId: string; pluginId: string; taskId: string; view: BrowserPanelView | null }
}

// Which sessions and tasks changed on the selected Node since the last hint. Nothing more: the
// sidebar reads the durable state again rather than trusting a pushed copy. `missed` means the Node
// dropped frames for this reader, so anything may have changed. `requests` means a request was raised,
// claimed, settled, or expired, so the badge reads the open requests again.
export type BridgeAgentHint = {
  nodeId: string
  sessions: string[]
  tasks: string[]
  missed: boolean
  requests: boolean
}

export type BridgeErrorCode =
  | 'bad_request'
  | 'no_probe'
  | 'pairing_failed'
  | 'pairing_required'
  | 'unknown_node'
  | 'not_selected'
  | 'incompatible'
  | 'identity_mismatch'
  | 'revoked'
  | 'node_unreachable'
  | 'not_found'
  // A write whose request may have reached the Node. Retry it with the same key.
  | 'ambiguous_mutation'
  | 'node_error'
type BridgeError = { code: BridgeErrorCode; message: string }

// Host to extension. A reply answers one request; chunks carry a reply too large for one message;
// a status event reports the selected node's connection; an agents event is a coalesced change hint.
export type BridgeHostMessage =
  | { v: 1; id: string; ok: true; result: unknown }
  | { v: 1; id: string; ok: false; error: BridgeError }
  | { v: 1; id: string; chunk: { index: number; count: number; data: string } }
  | { v: 1; event: 'status'; status: NodeStatus }
  | ({ v: 1; event: 'agent' } & BridgeAgentHint)
  // The selected Node's plugin set changed, so its handoffs may have too.
  | { v: 1; event: 'handoffs'; nodeId: string }
  // A project on the selected Node changed, so its site associations may have too.
  | { v: 1; event: 'projects'; nodeId: string }
  // A task on the selected Node was created, changed, or archived, or its links changed.
  | { v: 1; event: 'tasks'; nodeId: string }
