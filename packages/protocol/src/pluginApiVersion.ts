// The plugin API's major version, and the check a manifest's `apiVersion` is held to.
//
// Its own file because apps/node/scripts/build-plugin.mjs imports it directly with Node's type
// stripping, before anything is built. Nothing here may import anything else, and nothing here may
// need more than type stripping to run.
//
// See docs/plugins.md § Activation for what bumping this number costs.
export const PLUGIN_API_MAJOR = '6'

// What a manifest may write in `apiVersion`: one major ('4'), a list ('3 || 4'), or an inclusive span
// ('2-4'). Mixed lists of both are fine ('2 || 4-6').
//
// A range rather than the exact string this used to compare, because the day PLUGIN_API_MAJOR moves,
// every plugin built for the old one stops loading and no single build can work on both sides of the
// move. An author who has checked their plugin against two majors can now say so and ship once.
//
// Majors only. There is no minor and no patch in this number: it names a surface, and every other
// compatibility question the surface snapshot answers (packages/plugin-api/src/surface.test.ts).
export const PLUGIN_API_RANGE_RE = /^\d{1,4}(-\d{1,4})?(\s*\|\|\s*\d{1,4}(-\d{1,4})?)*$/

/** Whether a manifest's declared range covers this build's major. `false` for anything that is not a
 *  range, so a typo reads as incompatible rather than as "matches nothing, quietly". */
export function speaksApiVersion(declared: string, host: string = PLUGIN_API_MAJOR): boolean {
  const trimmed = declared.trim()
  if (!PLUGIN_API_RANGE_RE.test(trimmed)) return false
  const target = Number(host)
  if (!Number.isFinite(target)) return false
  return trimmed.split('||').some((term) => {
    const [low, high] = term.trim().split('-')
    const from = Number(low)
    return target >= from && target <= (high === undefined ? from : Number(high))
  })
}
