import { createLogger } from '@acorn/node-core/server/telemetry'
import { TrustStore } from '../rules/trustStore'
import { FileTrustStorage } from './fileStorage'

export type { PluginAck } from '../rules/trustStore'

// This device's decisions about which plugin bundles it will run, kept in a file beside the device
// tokens. The rules are `TrustStore`'s (../rules/trustStore.ts), shared with the phone.
export class PluginTrustStore extends TrustStore {
  constructor(userDataDir: string) {
    super(new FileTrustStorage(userDataDir), createLogger('plugins'))
  }
}
