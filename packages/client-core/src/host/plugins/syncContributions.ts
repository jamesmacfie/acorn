import { batch } from 'solid-js'
import { createLogger } from '../../infra/telemetry/logger'

type Passes = { frames(): void; chrome(): void }

const log = createLogger('plugins')
let passes: Passes | undefined
let loading: Promise<Passes> | undefined

// The frame and chrome hosts are only needed once a loaded plugin is accepted, so they load on the first
// pass rather than at startup. This module owns the one loader promise. A failed import is forgotten so
// the next pass, after a commit or a node change, imports again.
const loadPasses = (): Promise<Passes> =>
  (loading ??= Promise.all([import('../frames/register'), import('../chrome/chromeRegister')])
    .then(
      ([frames, chrome]) =>
        (passes = { frames: frames.syncFrameContributions, chrome: chrome.syncChromeContributions }),
    )
    .catch((error: unknown) => {
      loading = undefined
      throw error
    }))

const run = ({ frames, chrome }: Passes): void =>
  batch(() => {
    frames()
    chrome()
  })

/**
 * Both registration passes, in order. They must always run as a pair, since the frames pass draws the
 * rectangles and the chrome pass registers the commands and rail rows that open them, and that pairing
 * used to exist only as a comment beside two call sites.
 *
 * Resolves once this node's loaded contributions are registered, which is what a deep link to a loaded
 * route waits for (./reload.ts `preparePluginContributionsForNode`). Once the hosts have loaded, the pass
 * runs synchronously, so a commit that withdraws a plugin takes its surfaces down in the same tick. Before
 * then nothing is registered, so there is nothing to withdraw.
 *
 * Its own file rather than a third export of contributions.ts, only to keep the import graph acyclic:
 * both register modules import the eligibility rules, so the module that calls them can't be the same
 * one they depend on.
 */
export function syncPluginContributions(): Promise<void> {
  if (passes) {
    run(passes)
    return Promise.resolve()
  }
  return loadPasses().then(run)
}

/** For a caller that doesn't wait, such as a distribution commit. The next pass retries a failed import. */
export function syncPluginContributionsInBackground(): void {
  syncPluginContributions().catch((error: unknown) => log.warn('could not load the plugin contribution hosts', error))
}
