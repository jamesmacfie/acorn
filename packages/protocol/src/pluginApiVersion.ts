// The plugin API's major version, alone in a file so a build script can import it.
//
// It used to be one const inside api.ts. apps/node/scripts/build-plugin.mjs is a plain .mjs that
// cannot import a built package, so it scraped the number out of the source text with a regex. A
// 650-line file that is also load-bearing for a regex is one edit away from a build that stamps the
// wrong number into every plugin it packages. A file with one export cannot drift out from under that.
//
// See docs/plugins.md § Activation for what bumping this number costs and why it moved once, on
// 2026-08-14.
export const PLUGIN_API_MAJOR = '2'
