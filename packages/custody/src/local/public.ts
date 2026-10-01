import { FleetStore } from '../broker/fleetStore'
import { deviceTokens, type DeviceTokens, type TokenCipher } from '../custody/deviceTokenStore'
import { configDir } from './paths'

const fileModeOnly: TokenCipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(value, 'utf8'),
  decrypt: (blob) => blob.toString('utf8'),
}

export type Custody = { tokens: DeviceTokens; fleet: FleetStore }
export const custody = (dir: string = configDir()): Custody => {
  const tokens = deviceTokens(dir, fileModeOnly)
  return { tokens, fleet: new FleetStore(dir, tokens) }
}

export { configDir, dataRootDir } from './paths'
export { knownNodeId, runningNode, type RunningNode } from './attach'
export { pairInteractively } from './pair'
export { AmbiguousNodeError, rememberedNode } from './selection'
