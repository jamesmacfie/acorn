import { BundleCache, pluginDecisions, TrustStore, webCryptoSha256, type BundleFetcher } from '@acorn/custody/rules'
import type { BundledAck, RulesLog } from '@acorn/custody/rules'
import type { PluginCustody } from '@acorn/client-core/infra/platform'
import { setTreeBundleSource } from '@acorn/client-core/host/tree'
import { createLogger } from '@acorn/client-core/infra/telemetry'
import { firstPartyBundles } from './firstPartyBundles'
import { openPluginStorage } from './pluginStorage'

// The phone's `plugins` seam group: the custody rules the desktop and the terminal client run, over
// this browser's storage (docs/mobile/plugin-custody.md). The decisions are `@acorn/custody/rules`'s,
// so a bundle's hash, its trust record, and the prompt on an update come out as they do on a computer.
// What is left here is what a phone is: no plugins installed from it, and the bytes in the page.
//
// `platform.ts` loads this with the first thing that asks for a plugin, after the first frame.

const log = createLogger('plugins')
// The rules log a message and its attributes. This logger takes a detail between the two.
const rulesLog: RulesLog = {
  warn: (message, attributes) => log.warn(message, undefined, attributes),
  error: (message, attributes) => log.error(message, undefined, attributes),
}

const FROM_THE_DESKTOP = 'Install plugins from the desktop.'

export type PhonePluginCustody = {
  custody: PluginCustody
  /** A Node this phone forgot no longer offers its bundles, as on the desktop. */
  forgetNode(nodeId: string): Promise<void>
}

export async function openPluginCustody(
  fetcher: BundleFetcher,
  firstParty: readonly BundledAck[] = firstPartyBundles,
): Promise<PhonePluginCustody> {
  const storage = await openPluginStorage()
  const cache = new BundleCache(storage.bundles, fetcher, webCryptoSha256, rulesLog)
  const trust = new TrustStore(storage.trust, rulesLog)
  cache.sweep()
  const decisions = pluginDecisions(cache, trust, rulesLog)
  // The page is the only process, so the sandbox's bytes come from here. Nothing starts before the
  // first `state()` has opened this, because no plugin is selected until the roster has been read.
  setTreeBundleSource(storage.readBundle)

  // An answer the person is told about waits until what it says is in IndexedDB.
  const kept =
    <Asked, Result>(decide: (asked: Asked) => Promise<Result>) =>
    async (asked: Asked): Promise<Result> => {
      const result = await decide(asked)
      await storage.flush()
      return result
    }

  // A bundle whose hash this phone computed from the bytes, and which this release carries, was built
  // from the same source as the desktop's own: it is accepted with the disclosure the build recorded,
  // not the one the Node sends (docs/mobile/plugin-custody.md § First-party bundles).
  const cachePut = async (asked: Parameters<PluginCustody['cachePut']>[0]) => {
    const result = await decisions.cachePut(asked)
    if ('hash' in result) {
      const carried = firstParty.find((ack) => ack.pluginId === asked.pluginId && ack.hash === result.hash)
      if (carried) trust.record({ ...carried, decidedAt: Date.now() })
    }
    return result
  }

  return {
    custody: {
      state: decisions.state,
      cachePut: kept(cachePut),
      trustRecord: kept(decisions.trustRecord),
      trustForget: kept(decisions.trustForget),
      devGrant: kept(decisions.devGrant),
      install: () => Promise.reject(new Error(FROM_THE_DESKTOP)),
      remove: () => Promise.reject(new Error(FROM_THE_DESKTOP)),
    },
    forgetNode: async (nodeId) => {
      cache.forgetNode(nodeId)
      await storage.flush()
    },
  }
}
