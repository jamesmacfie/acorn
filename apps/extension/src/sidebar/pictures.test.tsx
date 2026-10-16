import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type {
  BridgeAgentRequest,
  BridgeAgentSession,
  BridgeConversationRecord,
  BridgeHandoffItem,
  BridgePageTask,
} from '@acorn/protocol/extensionBridge.ts'
import { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
import { PROVIDER_MARKS } from '@acorn/plugin-agents/contract/providerMarks.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle } from '../test/fakeBrowser'
import { button, goHome, openChat, tab } from '../test/sidebarUi'
import { App } from './App'

// The sidebar pictures on the public site's browser extension pages (docs/site/specimens.md). Each scene
// mounts the real sidebar under jsdom against a scripted Node, as the other sidebar tests do, and keeps
// its markup in apps/site/src/generated/sidebar/. With UPDATE_SPECIMENS=1 it writes the files, and
// otherwise fails when one differs, so a sidebar change can't leave an old picture on the site.

// By path, because jsdom gives this module a web address rather than a file one.
const OUT = join(import.meta.dirname, '../../../site/src/generated/sidebar/')
const UPDATE = process.env.UPDATE_SPECIMENS === '1'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

beforeAll(() => {
  // The specimens' clock, so "2 minutes ago" reads the same on every machine.
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  for (const mark of PROVIDER_MARKS) if (!brandMarkRegistry.get(mark.id)) brandMarkRegistry.register(mark)
})

const NOW = Date.parse('2026-01-15T12:00:00Z')
const PULL = 'https://github.com/fernwood/billing-api/pull/128'
const OTHER_PULL = 'https://github.com/fernwood/billing-api/pull/131'

type Request = Record<string, unknown> & { id: string; op: string }

const session = (id: string, title: string, extra: Partial<BridgeAgentSession> = {}): BridgeAgentSession => ({
  id,
  taskId: 't1',
  title,
  providerId: 'claude',
  profileId: 'claude-code',
  model: 'Opus · High',
  kind: 'interactive',
  inline: false,
  runtimeState: 'ready',
  attention: 'none',
  lastEventSeq: 0,
  archivedAt: null,
  updatedAt: NOW - 120_000,
  ...extra,
})

const message = (seq: number, type: 'user_message' | 'assistant_message', text: string): BridgeConversationRecord => ({
  id: `s1-e${seq}`,
  seq,
  turnId: null,
  createdAt: NOW - 300_000 + seq * 1000,
  event: { type, text },
})

const permission: BridgeAgentRequest = {
  requestId: 'r1',
  kind: 'permission',
  status: 'pending',
  title: 'Run pnpm test webhooks',
  detail: 'pnpm test webhooks\nIn billing-api',
  options: [
    { id: 'allow_once', label: 'Allow', reject: false },
    { id: 'reject_once', label: 'Reject', reject: true },
  ],
  questions: [],
  approval: null,
  answer: null,
  sentNote: null,
  unsupported: null,
}

// The pull request's page belongs to the task, as GitHub's address for its pull number.
const pageTasks: BridgePageTask[] = [
  {
    id: 't1',
    title: 'Retry failed webhooks',
    branch: 'retry-webhooks',
    projectId: 'p1',
    pages: [{ origin: 'https://github.com', pathPrefix: '/fernwood/billing-api/pull/128', source: 'github' }],
  },
  { id: 't2', title: 'Add VAT to EU invoices', branch: 'eu-vat', projectId: 'p1', pages: [] },
]

const handoffItem: BridgeHandoffItem = {
  identifier: 'fernwood/billing-api#131',
  url: OTHER_PULL,
  title: 'Speed up the overdue invoices query',
  connection: { id: 'gh', label: 'GitHub' },
  projects: [{ id: 'p1', name: 'billing-api' }],
  linkedTasks: [],
  context: null,
}

// The Acme app a task runs, and the panel the acme-browser example plugin answers for it
// (examples/plugins/acme-browser/node.js).
const ACME_APP = 'https://acme-5b0d7c39.localhost:5173'
const acmePanel = {
  blocks: [
    { kind: 'status', label: 'Acme app', state: 'running', severity: 'info' },
    {
      kind: 'links',
      title: 'Open',
      links: [
        { label: 'App', url: ACME_APP },
        { label: 'Health', url: `${ACME_APP}/health` },
      ],
    },
  ],
}

// One Node, Fernwood, with the site fixture's project and tasks: a scripted host like the other
// sidebar tests', answering only what these scenes read.
function mount(options: { url: string; title: string; paired?: boolean; waiting?: boolean; panel?: boolean }) {
  const fake = fakeBrowser()
  fake.activeTab = { id: 1, windowId: 1, url: options.url, title: options.title }
  const sessions = [
    session('s1', 'Why do retries stop?', { runtimeState: options.waiting ? 'working' : 'ready', lastEventSeq: 3 }),
    session('s2', 'Add a backoff test', { providerId: 'codex', profileId: 'codex', model: 'gpt-5.5' }),
  ]
  const records = [
    message(1, 'user_message', 'Why do webhook retries stop after the first failure?'),
    message(
      2,
      'assistant_message',
      '`deliver` returns as soon as the first attempt fails, so the backoff loop never runs. I can move the return below the loop and add a test.',
    ),
    message(3, 'user_message', 'Yes, do that.'),
  ]
  const nodes = options.paired
    ? {
        nodes: [{ nodeId: 'n1', label: 'Fernwood', endpoint: 'https://127.0.0.1:4317', local: true }],
        activeNodeId: 'n1',
        status: { nodeId: 'n1', state: 'online' },
      }
    : { nodes: [], activeNodeId: null, status: null }
  const answer = (request: Request): unknown => {
    switch (request.op) {
      case 'nodes.list':
      case 'node.select':
        return nodes
      case 'node.local':
        return {
          nodeId: 'n1',
          endpoint: 'https://127.0.0.1:4317',
          fingerprint: 'ab'.repeat(32),
          protocolVersion: 1,
          baseline: 'acorn-1',
          compatible: true,
        }
      case 'projects.list':
        return {
          nodeId: 'n1',
          projects: [{ id: 'p1', name: 'billing-api', path: null, hidden: false, workspaceId: 'w1' }],
          workspaces: [{ id: 'w1', name: 'Fernwood' }],
        }
      case 'tasks.pages':
        // With the panel, the task's app also answers at its own address.
        return {
          nodeId: 'n1',
          tasks: options.panel
            ? pageTasks.map((task) =>
                task.id === 't1'
                  ? { ...task, pages: [...task.pages, { origin: ACME_APP, pathPrefix: '/', source: 'acme-browser' }] }
                  : task,
              )
            : pageTasks,
        }
      case 'sites.list':
        return { nodeId: 'n1', sites: [] }
      case 'handoffs.list':
        return {
          nodeId: 'n1',
          handoffs: [
            {
              pluginId: 'github',
              id: 'pull',
              label: 'Open in Acorn',
              match: ['https://github.com/{owner}/{repo}/pull/{number}'],
              anchors: [],
            },
          ],
          panels: options.panel ? [{ pluginId: 'acme-browser', label: 'Acme app', glyph: 'app-window' }] : [],
        }
      case 'plugin.panel':
        return { nodeId: 'n1', pluginId: request.pluginId, taskId: request.taskId, view: acmePanel }
      case 'handoff.resolve':
        return { nodeId: 'n1', url: request.url, items: [handoffItem] }
      case 'sessions.list':
        return request.workspaceId
          ? { nodeId: 'n1', workspaceId: request.workspaceId, sessions }
          : { nodeId: 'n1', taskId: request.taskId, sessions: request.taskId === 't1' ? sessions : [] }
      case 'session.read': {
        const row = sessions.find((candidate) => candidate.id === request.sessionId)!
        const read = row.id === 's1' ? records.filter((record) => record.seq > (request.afterSeq as number)) : []
        return {
          nodeId: 'n1',
          sessionId: row.id,
          session: row,
          records: read,
          reach: read.at(-1)?.seq ?? request.afterSeq,
          queued: [],
          requests: options.waiting && row.id === 's1' ? [permission] : [],
        }
      }
      case 'requests.pending':
        return {
          nodeId: 'n1',
          requests: options.waiting
            ? [
                {
                  requestId: 'r1',
                  sessionId: 's1',
                  taskId: 't1',
                  projectId: 'p1',
                  kind: 'permission',
                  title: permission.title,
                  taskTitle: 'Retry failed webhooks',
                },
              ]
            : [],
        }
      case 'workflows.list':
        return {
          nodeId: 'n1',
          projectId: request.projectId,
          workflows: [{ id: 'fix', name: 'Fix an issue', inputs: [{ name: 'issue', label: 'Issue', required: true }] }],
        }
      case 'workflow.runs':
        return { nodeId: 'n1', taskId: request.taskId, runs: [] }
      case 'agents.choices':
        return { nodeId: 'n1', choices: [] }
      default:
        throw new Error(`The pictures' Node doesn't answer ${request.op}.`)
    }
  }
  fake.onNativeMessage = (raw, host) => {
    const request = raw as Request
    host.send({ v: 1, id: request.id, ok: true, result: answer(request) })
  }
  if (options.paired) fake.storage.set('selectedNodeId', 'n1')
  startBackground(fake.api, 'com.acorn.browser_bridge')
  const root = document.createElement('div')
  document.body.append(root)
  dispose = render(() => <App api={fake.api} opensLinks />, root)
  return { fake, root }
}

/** Writes the scene's markup, or compares it with the committed file. */
function picture(id: string, root: HTMLElement) {
  // A field holds what was typed as a property, which markup leaves out.
  for (const field of root.querySelectorAll('textarea')) field.textContent = field.value
  // The wrapper the site scopes the panel's own stylesheet to, as a browser snapshot has.
  const html = `<div class="snapshot-sidebar">${root.innerHTML}</div>\n`
  const file = `${OUT}${id}.html`
  if (UPDATE) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(file, html)
    return
  }
  expect(html, `${id}.html is stale. Run UPDATE_SPECIMENS=1 pnpm --filter @acorn/site specimens.`).toBe(
    readFileSync(file, 'utf8'),
  )
}

describe('the sidebar pictures on the site', () => {
  it('pairing with the Node on this computer', async () => {
    const { root } = mount({ url: 'https://example.com/', title: 'Example Domain' })
    await settle(40)
    expect(root.textContent).toContain('This computer')
    picture('sidebar-pairing', root)
  })

  it("Home on a pull request's page, with a request waiting", async () => {
    const { root } = mount({
      url: PULL,
      title: 'Retry failed webhooks · Pull Request #128',
      paired: true,
      waiting: true,
    })
    await settle(40)
    // The panel opens on the page's task; Back shows Home.
    await goHome(root)
    expect(root.querySelector('[aria-label="This page"]')?.textContent).toContain('Retry failed webhooks')
    expect(root.querySelector('.view [aria-label="Needs you"]')).toBeTruthy()
    picture('sidebar-home', root)
  })

  it("a conversation with the page's selected text in the draft", async () => {
    const { fake, root } = mount({ url: PULL, title: 'Retry failed webhooks · Pull Request #128', paired: true })
    await settle(40)
    await openChat(root, 'Why do retries stop?')
    // The page's right-click entry, Add to Acorn chat, on a review comment.
    fake.selection = 'Should the last retry wait the full hour?'
    fake.clickMenu('add-to-acorn-chat')
    await settle(40)
    const box = root.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!
    box.value = 'Check the review comments on this pull request too.'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await settle(20)
    expect(root.querySelector('[aria-label="Conversation"]')?.textContent).toContain('backoff loop')
    picture('sidebar-conversation', root)
  })

  it('the handoff card for a pull request no task holds', async () => {
    const { root } = mount({
      url: OTHER_PULL,
      title: 'Speed up the overdue invoices query · Pull Request #131',
      paired: true,
    })
    await settle(40)
    expect(button(root, 'Create task')).toBeDefined()
    picture('sidebar-handoff', root)
  })

  it("a plugin's panel for the page's task", async () => {
    const { root } = mount({ url: `${ACME_APP}/`, title: 'Acme', paired: true, panel: true })
    await settle(40)
    await tab(root, 'Acme app')
    expect(root.querySelector('.view[aria-label="Acme app"] .panel-head .ui-heading-title')?.textContent).toBe(
      'Acme app',
    )
    picture('sidebar-plugin-panel', root)
  })
})
