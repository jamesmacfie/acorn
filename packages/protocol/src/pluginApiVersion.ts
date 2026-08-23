// The plugin API's major version, alone in a file so a build script can import it.
//
// Its own file because apps/node/scripts/build-plugin.mjs is a plain .mjs that cannot import a built
// package, so it scrapes the number out of the source text with a regex. A file with one export
// cannot drift out from under that regex; api.ts, at 650 lines, could.
//
// See docs/plugins.md § Activation for what bumping this number costs.
export const PLUGIN_API_MAJOR = '2'
