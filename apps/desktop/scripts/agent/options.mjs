import { resolve } from 'node:path'
import { repoRoot, validateSessionName } from './state.mjs'

const FIXTURES = ['large-surfaces', 'tui-navigation', 'delegation-checks', 'unattended-policy']
const PROFILES = ['small', 'scale', 'canonical']

export function parseAgentSessionOptions(argv) {
  const options = { session: null, project: repoRoot, onboarding: false, reuse: false, smoke: false, vite: false, fixture: null, profile: 'small', seed: 1, workspaces: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--session') options.session = validateSessionName(argv[++index] ?? '')
    else if (arg === '--project') options.project = resolve(argv[++index] ?? '')
    else if (arg === '--onboarding') options.onboarding = true
    else if (arg === '--reuse') options.reuse = true
    else if (arg === '--smoke') options.smoke = true
    else if (arg === '--vite') options.vite = true
    else if (arg === '--fixture') options.fixture = argv[++index] ?? ''
    else if (arg === '--profile') options.profile = argv[++index] ?? ''
    else if (arg === '--seed') options.seed = Number(argv[++index])
    else if (arg === '--workspaces') options.workspaces = argv[++index] ?? ''
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (options.smoke) options.onboarding = true
  if (options.onboarding && argv.includes('--project')) throw new Error('Use either --onboarding or --project, not both.')
  if (options.workspaces !== null && !['on', 'off'].includes(options.workspaces)) throw new Error('--workspaces must be on or off.')
  if (options.onboarding && options.workspaces) throw new Error('--workspaces cannot be used with --onboarding.')
  if (options.fixture !== null) {
    if (!FIXTURES.includes(options.fixture)) throw new Error(`Unknown fixture: ${options.fixture}. Known: ${FIXTURES.join(', ')}.`)
    if (options.onboarding || argv.includes('--project') || argv.includes('--smoke')) throw new Error('A fixture brings its own project; drop --onboarding, --project and --smoke.')
    if (!PROFILES.includes(options.profile)) throw new Error(`Unknown profile: ${options.profile}. Known: ${PROFILES.join(', ')}.`)
    if (!Number.isInteger(options.seed)) throw new Error('The seed must be a whole number.')
  } else if (argv.includes('--profile') || argv.includes('--seed')) {
    throw new Error('--profile and --seed only mean something with --fixture.')
  }
  return options
}
