import { type IntegrationFlowContribution, postJson } from '@acorn/plugin-api/client'

export const gitlabIntegrationFlow: IntegrationFlowContribution = {
  id: 'gitlab',
  deviceFlow: {
    start: () => postJson('/v1/p/gitlab/auth/device/start'),
    poll: (deviceCode) => postJson('/v1/p/gitlab/auth/device/poll', { deviceCode }),
  },
}
