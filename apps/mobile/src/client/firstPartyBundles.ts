import type { BundledAck } from '@acorn/custody/rules'

/** The build's list, from `scripts/build-first-party.mjs` through `vite.config.ts`. Unset under test. */
declare const __ACORN_FIRST_PARTY_BUNDLES__: readonly BundledAck[] | undefined

/** The acceptances for the first-party bundles of this phone's release. A Node from the same release
 *  offers these hashes and they need no prompt. Another release offers others, which prompt. */
export const firstPartyBundles: readonly BundledAck[] =
  typeof __ACORN_FIRST_PARTY_BUNDLES__ === 'undefined' ? [] : __ACORN_FIRST_PARTY_BUNDLES__
