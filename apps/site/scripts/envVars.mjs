// Every `ACORN_*` name the Node, the command line, and the terminal client mention, and the check that
// the Environment variables page lists each one or this file names it as internal (docs/site.md).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './stale.mjs'

// The Node, the command line, the terminal client, and the custody package the last two share.
const RUNTIMES = ['apps/node/src', 'packages/node-core/src', 'apps/cli/src', 'apps/cli/bin', 'apps/tui/src', 'packages/custody/src']

const PAGE = 'apps/site/src/content/docs/docs/reference/environment-variables.md'

// Names the page leaves out on purpose, with the reason. A key ending in `*` covers every name with
// that prefix.
const INTERNAL = {
  ACORN_BASELINE: 'A constant naming the data format, not a variable.',
  ACORN_BUILD: 'A constant naming the build, not a variable.',
  ACORN_PIN_MISMATCH: 'An error code, not a variable.',
  'ACORN_FIXTURE_*': "Switches for the terminal client's test fixture.",
  'ACORN_CLI_*': 'The command line sets these for the Node it starts with `node start --background`.',
  ACORN_TUI_NODE_ENTRY: 'Points a development terminal client at a Node build.',
  ACORN_MCP_NAME: 'The Node sets this for the MCP server it registers with each harness.',
  ACORN_SKIP_MCP_REGISTRATION: 'Set by `pnpm dev:agent`, so a throwaway session leaves the MCP registration alone.',
  ACORN_PROMPT_BUNDLED_PLUGIN_TRUST: "For testing the trust prompt on acorn's own plugins.",
  ACORN_CONTROL_PLANE_URL: 'Set by a control plane that provisions a Node.',
  ACORN_ENROLLMENT_TOKEN: 'Set by a control plane that provisions a Node.',
}

const NAME = /\bACORN_[A-Z0-9_]+\b/g
const SOURCE = /\.(?:ts|tsx|mjs|js)$/
const TEST = /\.test\.|\.spec\.|(?:^|\/)test\//

/** Every `ACORN_*` name in the runtimes' source, tests left out. */
export function runtimeNames() {
  const files = RUNTIMES.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .filter((file) => SOURCE.test(file) && !TEST.test(file))
      .map((file) => join(ROOT, dir, file)),
  )
  return [...new Set(files.flatMap((file) => readFileSync(file, 'utf8').match(NAME) ?? []))].sort()
}

/** Every `ACORN_*` name a page's text mentions. */
export const pageNames = (text) => [...new Set(text.match(NAME) ?? [])].sort()

const isInternal = (name, internal) =>
  Object.keys(internal).some((key) => (key.endsWith('*') ? name.startsWith(key.slice(0, -1)) : name === key))

/** What's wrong between the names the runtimes use and the names the page lists. */
export function envProblems(used, listed, internal = INTERNAL) {
  return [
    ...used
      .filter((name) => !listed.includes(name) && !isInternal(name, internal))
      .map((name) => `${name} is in the runtimes' source, and the page neither lists it nor names it as internal`),
    ...listed
      .filter((name) => !used.includes(name))
      .map((name) => `The page lists ${name}, which nothing in the runtimes mentions`),
    ...listed
      .filter((name) => isInternal(name, internal))
      .map((name) => `The page lists ${name}, which is named as internal`),
  ]
}

export const listedOnPage = () => pageNames(readFileSync(join(ROOT, PAGE), 'utf8'))
