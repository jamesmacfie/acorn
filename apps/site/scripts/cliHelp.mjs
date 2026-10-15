// The command line's own help text, for the Command line reference (docs/site.md). The site runs the
// built `acorn` launcher with `--help` rather than importing the command line's source, because apps
// never import each other, and this way the page can't say anything the binary doesn't.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const LAUNCHER = fileURLToPath(new URL('../../cli/bin/acorn.mjs', import.meta.url))
const BUILT = new URL('../../cli/dist/cli.js', import.meta.url)

const help = (args) => execFileSync(process.execPath, [LAUNCHER, ...args, '--help'], { encoding: 'utf8' })

/** The overview, then each command's help, in the order the overview lists them. A command is the first
 *  word of each usage line, so a new one appears here without an edit to the site. */
function cliHelp() {
  if (!existsSync(BUILT)) throw new Error('The command line is not built. Run pnpm --filter @acorn/cli build.')
  const overview = help([])
  const commands = [...overview.matchAll(/^(?:Usage:)?\s*acorn (?:\[[^\]]*\] )?([a-z]+)/gm)].map(([, command]) => command)
  return { overview, commands: commands.map((command) => ({ command, text: help([command]) })) }
}

/** Serves `virtual:acorn-cli-help`, read again on every build and dev start. */
export function cliHelpModule() {
  const id = 'virtual:acorn-cli-help'
  return {
    name: 'acorn-cli-help',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load: (source) => (source === `\0${id}` ? `export default ${JSON.stringify(cliHelp())}` : undefined),
  }
}
