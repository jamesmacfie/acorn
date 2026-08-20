import { syncChromeContributions } from './chrome/register'
import { syncFrameContributions } from './frames/register'

/**
/**
 * Both registration passes, in order. They must always run as a pair, since the frames pass draws the
 * rectangles and the chrome pass registers the commands and rail rows that open them, and that pairing
 * used to exist only as a comment beside two call sites.
 *
 * Its own file rather than a third export of contributions.ts, only to keep the import graph acyclic:
 * both register modules import the eligibility rules, so the module that calls them can't be the same
 * one they depend on.
 */
export function syncPluginContributions(): void {
  syncFrameContributions()
  syncChromeContributions()
}
