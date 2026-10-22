import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { accountIntegrationFlow } from './integrationFlow'

const AccountSettings = lazy(() => import('./AccountSettings'))

export const accountClientPlugin: ClientPlugin = {
  name: 'account',
  init: (ctx) => {
    ctx.integrationFlows.register(accountIntegrationFlow)
    ctx.settingsPages.register({
      id: 'account',
      label: 'Account',
      category: 'machines',
      scope: 'node',
      icon: 'user-round',
      // Beside Nodes, which it extends: remote access is how another network reaches this Node.
      order: 15,
      requires: { plugin: 'account' },
      keywords: ['sign in', 'relay', 'remote access', 'another network'],
      sections: [
        { id: 'account', label: 'Account', rows: ['Sign in', 'Signed in as'] },
        { id: 'remote-access', label: 'Remote access', rows: ['Remote access'], keywords: ['relay'] },
      ],
      component: AccountSettings,
    })
  },
}
