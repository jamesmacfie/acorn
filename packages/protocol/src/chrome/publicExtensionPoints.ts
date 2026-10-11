// Every extension point another plugin can fill, for the `plugin_authoring` guide. Points are
// registered in client code, which the node can't import, so the node reads this list instead.
// apps/desktop/test/client/publicExtensionPoints.test.ts compares it with the client registry, so a
// point registered without an entry here fails there. See docs/agent-tools/plugin-tools.md §
// plugin_authoring.
import type { ArbitrationMode } from './extensionPoints.ts'

type PublicPointCommon = {
  /** `<owner>:<point>`, as a contributor's `point` spells it. */
  id: string
  /** What an author needs that the shape can't say, such as an owner's consent. */
  note?: string
  /** How the terminal client differs. Absent means it draws wherever it draws the owner's view. */
  terminal?: string
}

export type PublicRemotePoint = PublicPointCommon & {
  kind: 'remote'
  mode: ArbitrationMode
  max: number
  /** What a contributor's `matches` patterns are compared with. Absent means no key. */
  matches?: string
  /** What the contributor's tree is mounted with. */
  props: string
  /** Owner actions a tree may call through `mount.host.invoke`. */
  actions?: readonly string[]
}

export type PublicAnnotationPoint = PublicPointCommon & {
  kind: 'annotation'
  /** The fields of each key the host posts, and of each mark's `key`. */
  key: readonly string[]
  max: number
  /** Marks kept from one contributor's answer. Absent means the registry default. */
  acceptedMarks?: number
}

export type PublicExtensionPoint = PublicRemotePoint | PublicAnnotationPoint

const MEDIA = {
  mode: 'replace', max: 1, matches: 'lowercase media type without parameters',
  props: '{ taskId, sessionId, media: { kind, id, filename, mediaType, byteSize? } }',
} as const
const DETAIL = {
  mode: 'stack', max: 2, props: '{ surface, item?, refId?, projectId? }',
  note: 'drawn by the host above the owner\'s detail view, outside its tree',
} as const

export const PUBLIC_EXTENSION_POINTS: readonly PublicExtensionPoint[] = [
  {
    id: 'core:link-preview', kind: 'remote', mode: 'replace', max: 1,
    matches: 'the HTTPS URL as `URL` parses it', props: '{ url, label?, taskId?, projectId?, ref? }',
    terminal: 'no hover, so pressing a link in a pane offers Preview',
  },
  {
    id: 'core:markdown-fence', kind: 'remote', mode: 'replace', max: 1,
    matches: 'a closed fence\'s lowercased language hint', props: '{ blockId, language, text, revision, taskId?, projectId? }',
    note: 'text up to 256 KiB; up to four open viewers per message; the owner keeps Source, Preview, and Copy',
    terminal: 'clipped at 20 rows',
  },
  { id: 'core:task', kind: 'annotation', key: ['task'], max: 4, acceptedMarks: 256 },
  {
    id: 'core:source', kind: 'annotation', key: ['sourceId', 'projectId'], max: 4, acceptedMarks: 256,
    note: 'only sources whose owner sets `statusAnnotations: true`; `projectId` is "" unless the source is project scoped',
  },
  {
    id: 'core:pane', kind: 'annotation', key: ['paneId', 'taskId'], max: 4, acceptedMarks: 256,
    note: 'only task panes whose owner sets `statusAnnotations: true`',
  },
  { id: 'core:storage', kind: 'remote', mode: 'stack', max: 4, props: '{ nodeId }' },
  { id: 'core:security', kind: 'remote', mode: 'stack', max: 4, props: '{ nodeId }' },
  { id: 'core:plugin-page', kind: 'remote', mode: 'stack', max: 4, props: '{ pluginId, nodeId }' },
  {
    id: 'agents:tool-card', kind: 'remote', mode: 'replace', max: 1,
    matches: 'the tool\'s name, or its kind when it has none', props: '{ tool, taskId, defaultOpen, fileChanges? }',
  },
  {
    id: 'agents:attachment', kind: 'remote', mode: 'replace', max: 1, actions: ['replace'],
    matches: 'a draft attachment\'s media type', props: '{ attachment, taskId, sessionId }',
  },
  { id: 'agents:transcript-attachment', kind: 'remote', ...MEDIA },
  { id: 'agents:artifact', kind: 'remote', ...MEDIA },
  { id: 'agents:composer-actions', kind: 'remote', mode: 'stack', max: 4, props: '{ taskId, sessionId }' },
  {
    id: 'agents:session-header', kind: 'remote', mode: 'stack', max: 2,
    props: '{ taskId, sessionId, providerId, tokenAccounting, costAccounting, turns }',
  },
  { id: 'agents:request-card', kind: 'remote', mode: 'stack', max: 2, props: '{ taskId, sessionId, requestId, kind, title }' },
  { id: 'git:diff-line', kind: 'annotation', key: ['file', 'line', 'side'], max: 4 },
  { id: 'git:push-actions', kind: 'remote', mode: 'stack', max: 2, props: '{ taskId, projectId, branch, upstream, ahead }' },
  {
    id: 'context:section', kind: 'remote', mode: 'stack', max: 2,
    matches: 'the section id', props: '{ task, onChanged, onPendingChange }',
    note: 'compiled contributors only, because the props carry callbacks a loaded tree can\'t receive',
  },
  { id: 'docker:stats-beside', kind: 'remote', mode: 'stack', max: 2, props: '{ container }' },
  { id: 'docker:container', kind: 'annotation', key: ['container'], max: 3 },
  {
    id: 'editor:document', kind: 'remote', mode: 'replace', max: 1,
    matches: 'the file\'s lowercased basename (`*.md`)', props: '{ taskId, path, text?, revision }',
  },
  {
    id: 'editor:file', kind: 'annotation', key: ['taskId', 'path'], max: 1, acceptedMarks: 256,
    note: 'asked about the open tabs and the files in expanded folders; never a folder',
  },
  { id: 'github:diff-line', kind: 'annotation', key: ['file', 'line', 'side'], max: 4 },
  { id: 'github:summary-badges', kind: 'remote', mode: 'stack', max: 4, props: '{ owner, repo, number }' },
  {
    id: 'preview:toolbar-actions', kind: 'remote', mode: 'stack', max: 4, actions: ['reload'],
    props: '{ taskId, projectId?, url?, loading, canGoBack, canGoForward }',
    terminal: 'never drawn, because the terminal has no Preview pane',
  },
  {
    id: 'terminal:toolbar-actions', kind: 'remote', mode: 'stack', max: 4, actions: ['interrupt'],
    props: '{ taskId, projectId?, session?: { id, title, running } }',
  },
  {
    id: 'workflows:step-body', kind: 'remote', mode: 'replace', max: 1,
    matches: 'the step\'s exact kind (`terminal:command`)',
    props: '{ taskId, projectId, runId, stepId, kind, status, inputs, inputsTruncated, output, outputTruncated, tail?, revision }',
  },
  // Declared in the Linear and Rollbar manifests rather than in code, so the registry test can't see
  // them. apps/node/test/integration/pluginSystem/pluginConfigs.test.ts holds them against the configs.
  { id: 'linear:issue-summary', kind: 'remote', ...DETAIL },
  { id: 'rollbar:item-summary', kind: 'remote', ...DETAIL },
]
