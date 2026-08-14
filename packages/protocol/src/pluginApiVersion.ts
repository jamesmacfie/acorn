// The plugin API's major version, alone in a file so a build script can import it.
//
// It used to be one const inside api.ts, which meant apps/node/scripts/build-plugin.mjs — a plain .mjs
// that cannot import a built package — scraped it out of the source text with a regex. A 650-line
// god-file that is also load-bearing for a regex is one edit away from a build that stamps the wrong
// number into every plugin it packages. A file with one export cannot drift out from under that.
//
// '1' → '2' on 2026-08-14: the facade shed seventy-one names — all but two had no consumer at all — and
// `CoreServices.tasks` stopped handing out the drizzle `tasks` row in favour of a `TaskRef` projection.
// Pruning is a hard break on a number three call sites compare by exact string match, so the number
// moved — once, honestly, while the entire cost was rebuilding five packages inside this repo and no
// out-of-tree plugin existed to strand. From here on packages/plugin-api/src/surface.test.ts refuses to
// regenerate a shrunken surface under an unchanged major, so the next removal cannot forget to do this.
export const PLUGIN_API_MAJOR = '2'
