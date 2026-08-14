// The plugin API's major version, alone in a file so a build script can import it.
//
// It used to be one const inside api.ts, which meant apps/node/scripts/build-plugin.mjs — a plain .mjs
// that cannot import a built package — scraped it out of the source text with a regex. A 650-line
// god-file that is also load-bearing for a regex is one edit away from a build that stamps the wrong
// number into every plugin it packages. A file with one export cannot drift out from under that.
export const PLUGIN_API_MAJOR = '1'
