import { Registry } from './registry'

export type DeviceFlowStart = {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type DeviceFlowPoll =
  | { status: 'pending'; slowDown?: boolean }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'connected'; integration?: unknown }

export type IntegrationFlowContribution = {
  id: string
  deviceFlow: {
    start(): Promise<DeviceFlowStart>
    poll(deviceCode: string): Promise<DeviceFlowPoll>
  }
}

export const integrationFlowRegistry = new Registry<IntegrationFlowContribution>('integration flow')
