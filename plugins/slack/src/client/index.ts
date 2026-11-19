import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { AGENT_COMPOSER_ACTIONS_POINT } from '@acorn/protocol/extensionPoints.ts'

const SlackSettings = lazy(() => import('./SlackSettings'))
const SlackComposerNote = lazy(async () => ({ default: (await import('./ComposerNote')).SlackComposerNote }))

export const slackClientPlugin: ClientPlugin = {
  name: 'slack',
  init: (ctx) => {
    ctx.settingsPages.register({
      id: 'slack',
      label: 'Slack',
      category: 'connections',
      scope: 'node',
      icon: 'messages-square',
      order: 40,
      requires: { plugin: 'slack' },
      keywords: ['slack', 'mention', 'dm', 'approvals', 'bot'],
      sections: [{ id: 'slack', label: 'Slack', rows: ['Link Slack', 'Answer approvals from Slack', 'Unlink'] }],
      component: SlackSettings,
    })
    ctx.extensions.register({
      id: 'slack.composer-note',
      point: AGENT_COMPOSER_ACTIONS_POINT,
      label: 'Shared to Slack',
      order: 90,
      component: SlackComposerNote,
    })
  },
}
