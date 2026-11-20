import { lazyRouter, registerDeletedTaskPurge, type NodePlugin } from '@acorn/plugin-api/node'
import type { SlackPlugin } from '../server/plugin'

// Slack for Acorn agents (docs/integrations/slack.md): a mention or a DM in Slack becomes an agent
// session on this Node, and its progress, approvals, and answers go back to the thread, through the
// account service's Slack gateway.
//
// Compiled rather than loaded, because it needs three seams only compiled plugins get: a gateway route,
// root task creation, and the account plugin's sign-in. Registration is all that runs at boot. The rest
// loads on the first delivery, settings request, or agents event, and does nothing until Slack is linked.
export const slackPlugin = (): NodePlugin => ({
  name: 'slack',
  label: 'Slack',
  migrationsModule: import.meta.url,
  init: (ctx) => {
    let started: Promise<SlackPlugin> | undefined
    const slack = () => (started ??= import('../server/plugin').then(({ startSlack }) => startSlack(ctx)))
    ctx.routes.gateway(async (request) => (await slack()).gateway(request))
    // No phone may change these, even with shell access: a link with approvals on lets a Slack user in.
    ctx.routes.register(
      lazyRouter(async () => (await slack()).settings),
      { prefix: '', note: 'Settings → Slack: linking and the approvals choice', phone: 'refused' },
    )
    for (const channel of [
      'plugin:agents:turn-changed',
      'plugin:agents:activity',
      'plugin:agents:request-changed',
      'plugin:agents:sessions-changed',
      'tasks:changed',
    ] as const)
      // An event can land as the Node stops or the plugin reloads, when this context and its database are
      // gone. Nothing is owed then: the next start's first event posts what turns settled meanwhile.
      ctx.events.on(
        channel,
        (frame) =>
          void slack()
            .then((plugin) => plugin.event(frame as never))
            .catch(() => undefined),
      )
    registerDeletedTaskPurge(ctx, async (taskIds) => (await slack()).purge([...taskIds]))
  },
})
