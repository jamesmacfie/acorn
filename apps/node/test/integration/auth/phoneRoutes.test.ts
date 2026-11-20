import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pluginPhoneAccess } from '@acorn/node-core/server/routes/registry.ts'
import { initCompiledPlugins } from '../../helpers/compiledPlugins'

// What the built-in plugins let a phone without shell access write (docs/relay/phone-channel.md § What a
// phone device may do). Each plugin names its phone writes where it registers its routes, and the phone
// rules refuse every write under /v1/p that no plugin named. Paths are in the form the rules match:
// decoded and in lower case.
describe('the built-in plugins’ phone writes', () => {
  let plugins: { dispose(): Promise<void> }
  beforeAll(async () => {
    plugins = await initCompiledPlugins()
  })
  afterAll(async () => plugins.dispose())

  // Each runs a program on the Node, decides what one runs, or writes a file a hook or script could run.
  it.each([
    ['POST', '/v1/p/terminal/sessions'],
    ['POST', '/v1/p/terminal/sessions/abc/send'],
    ['POST', '/v1/p/terminal/tasks/abc/setup'],
    ['PUT', '/v1/p/agents/sessions/abc/goal'],
    ['POST', '/v1/p/agents/sessions/abc/goal/resume'],
    ['POST', '/v1/p/agents/sessions/abc/implement-plan'],
    ['POST', '/v1/p/agents/sessions/abc/handoff-terminal'],
    ['PUT', '/v1/p/agents/sessions/abc/mcp'],
    ['POST', '/v1/p/agents/mcp-servers'],
    ['POST', '/v1/p/agents/custom-agents'],
    ['POST', '/v1/p/agents/instruction-review/abc/approve'],
    ['POST', '/v1/p/agents/providers/claude/accounts/work/terminal'],
    ['POST', '/v1/p/agents/transcript-imports'],
    ['POST', '/v1/p/workflows/defs'],
    ['POST', '/v1/p/workflows/workflows/runs/abc/gate'],
    ['POST', '/v1/p/workflows/workflows/runs/abc/retry'],
    ['POST', '/v1/p/workflows/workflows/schedules/abc/run'],
    ['POST', '/v1/p/workflows/workflows/triggers/abc/run'],
    ['PUT', '/v1/p/editor/tasks/abc/editor/file'],
    ['POST', '/v1/p/editor/tasks/abc/editor/create'],
    ['POST', '/v1/p/docker/containers/abc/action'],
    ['POST', '/v1/p/docker/compose/action'],
    ['PUT', '/v1/p/git/projects/abc/settings/identity'],
    ['POST', '/v1/p/github/import'],
    ['POST', '/v1/p/github/auth/device/start'],
    ['POST', '/v1/p/trellis/apps/abc/plugin'],
    ['POST', '/v1/p/trellis/apps/abc/publish'],
  ])('leaves %s %s to a phone with shell access', (method, path) => {
    expect(pluginPhoneAccess(method, path)).toBeNull()
  })

  it.each([
    ['POST', '/v1/p/agents/sessions'],
    ['POST', '/v1/p/agents/sessions/abc/turns'],
    ['POST', '/v1/p/agents/sessions/abc/turns/def/steer'],
    ['POST', '/v1/p/agents/sessions/abc/requests/def/resolve'],
    ['POST', '/v1/p/agents/sessions/abc/cancel'],
    ['PATCH', '/v1/p/agents/sessions/abc'],
    ['POST', '/v1/p/agents/attachments'],
    ['POST', '/v1/p/agents/usage/refresh/claude'],
    ['POST', '/v1/p/git/tasks/abc/local/commit'],
    ['POST', '/v1/p/git/tasks/abc/local/push'],
    ['POST', '/v1/p/git/tasks/abc/local/document/segments'],
    ['POST', '/v1/p/git/tasks/abc/review-notes'],
    ['POST', '/v1/p/git/projects/abc/revisions/def/segments'],
    ['POST', '/v1/p/editor/tasks/abc/search'],
    ['POST', '/v1/p/github/repos/acme/app/pulls/1/merge'],
    ['POST', '/v1/p/gitlab/projects/host/group%2fapp/merge-requests/1/notes'],
    ['POST', '/v1/p/bitbucket/repositories/acme/app/pull-requests/1/comments'],
    ['PUT', '/v1/p/notes/tasks/abc/notes/plan'],
    ['POST', '/v1/p/memory/library/edit'],
    ['POST', '/v1/p/preview/tasks/abc/recipe-url'],
    ['POST', '/v1/p/preview/tasks/abc/proxy/__acorn/open'],
    ['POST', '/v1/p/workflows/workflows/runs/abc/cancel'],
    ['PUT', '/v1/p/trellis/apps/abc/state'],
  ])('lets a phone without shell access make %s %s', (method, path) => {
    expect(pluginPhoneAccess(method, path)).toBe('write')
  })

  // These decide who else can reach the Node, so the phone rules refuse them to a phone with shell access
  // too (packages/node-core/src/server/middleware/phoneRules.ts).
  it.each([
    ['PUT', '/v1/p/account/remote-access'],
    ['PUT', '/v1/p/account/previews'],
    ['POST', '/v1/p/account/sign-out'],
    ['POST', '/v1/p/account/tickets'],
    ['POST', '/v1/p/account/auth/device/start'],
    ['POST', '/v1/p/account/auth/device/poll'],
    ['POST', '/v1/p/slack/link'],
    ['POST', '/v1/p/slack/confirm'],
    ['POST', '/v1/p/slack/unlink'],
    ['PUT', '/v1/p/slack/approvals'],
  ])('refuses %s %s to every phone', (method, path) => {
    expect(pluginPhoneAccess(method, path)).toBe('refused')
  })

  it('leaves reading the account and Slack settings open', () => {
    expect(pluginPhoneAccess('GET', '/v1/p/account/state')).toBeNull()
    expect(pluginPhoneAccess('GET', '/v1/p/slack/state')).toBeNull()
  })

  it('refuses reads through the preview proxy, which reaches the task’s app on this computer', () => {
    expect(pluginPhoneAccess('GET', '/v1/p/preview/tasks/abc/proxy/__open-in-editor')).toBe('loopback')
    expect(pluginPhoneAccess('POST', '/v1/p/preview/tasks/abc/proxy/api/run')).toBe('loopback')
  })
})
