import { syncChromeContributions } from './chrome/register'
import { syncFrameContributions } from './frames/register'

/**
 * Both registration passes, in order. They must always run as a pair — the frames pass draws the
 * rectangles, the chrome pass registers the commands and rail rows that open them — and until now that
 * pairing existed only as a comment beside two call sites that each invoked them back to back. A
 * pairing held together by a comment is one someone eventually breaks.
 *
 * Its own file rather than a third export of contributions.ts, only to keep the import graph acyclic:
 * both register modules import the eligibility rules, so the module that calls them cannot be the same
 * one they depend on.
 */
export function syncPluginContributions(): void {
  syncFrameContributions()
  syncChromeContributions()
}
