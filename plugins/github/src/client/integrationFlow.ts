import { postJson } from '@acorn/client-core/apiClient.ts'
import type { IntegrationFlowContribution } from '@acorn/client-core/registries/integrationFlows.ts'

const deviceStartRoute = '/v2/p/github/auth/device/start'
const devicePollRoute = '/v2/p/github/auth/device/poll'

export const githubIntegrationFlow: IntegrationFlowContribution = {
  id: 'github',
  deviceFlow: {
    start: () => postJson(deviceStartRoute),
    poll: (deviceCode) => postJson(devicePollRoute, { deviceCode }),
  },
}
