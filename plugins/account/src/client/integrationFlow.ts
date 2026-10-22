import { type IntegrationFlowContribution, postJson } from '@acorn/plugin-api/client'
import { accountRoute } from '../contract/routes'

// The sign-in device flow, for Settings → Account and for Add connection, which lists the same
// provider.
export const accountIntegrationFlow: IntegrationFlowContribution = {
  id: 'account',
  deviceFlow: {
    start: () => postJson(accountRoute('/auth/device/start')),
    poll: (deviceCode) => postJson(accountRoute('/auth/device/poll'), { deviceCode }),
  },
}
