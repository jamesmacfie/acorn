import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const FIXTURES = new Set(['large-surfaces', 'tui-navigation'])
const PROFILES = new Set(['small', 'scale', 'canonical'])

export function parseTuiAgentOptions(argv) {
  const options = {
    session: null, fixture: null, project: null, profile: 'small', seed: 1,
    reuse: false, onboarding: false, cols: 80, rows: 24, keyboard: 'kitty',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--session') options.session = argv[++index] ?? ''
    else if (arg === '--fixture') options.fixture = argv[++index] ?? ''
    else if (arg === '--project') {
      const path = argv[++index]
      if (!path || path.startsWith('--')) throw new Error('--project needs a path.')
      options.project = resolve(path)
    }
    else if (arg === '--profile') options.profile = argv[++index] ?? ''
    else if (arg === '--seed') options.seed = Number(argv[++index])
    else if (arg === '--cols') options.cols = Number(argv[++index])
    else if (arg === '--rows') options.rows = Number(argv[++index])
    else if (arg === '--keyboard') options.keyboard = argv[++index] ?? ''
    else if (arg === '--reuse') options.reuse = true
    else if (arg === '--onboarding') options.onboarding = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  options.session ??= `tui-${randomUUID().slice(0, 8)}`
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.session)) throw new Error('Invalid session name.')
  if (options.fixture && !FIXTURES.has(options.fixture)) throw new Error(`Unknown fixture: ${options.fixture}.`)
  if (!PROFILES.has(options.profile) || !Number.isInteger(options.seed)) throw new Error('Invalid fixture profile or seed.')
  if (!Number.isInteger(options.cols) || options.cols < 40 || options.cols > 500 ||
      !Number.isInteger(options.rows) || options.rows < 20 || options.rows > 500) {
    throw new Error('Terminal size must be 40–500 columns by 20–500 rows.')
  }
  if (!['kitty', 'legacy'].includes(options.keyboard)) throw new Error('Keyboard must be kitty or legacy.')
  if (options.onboarding && (options.fixture || options.project)) throw new Error('Onboarding cannot use a fixture or project.')
  if (options.fixture && options.project) throw new Error('A fixture supplies its own project.')
  if (!options.fixture && (argv.includes('--profile') || argv.includes('--seed'))) {
    throw new Error('--profile and --seed require --fixture.')
  }
  return options
}
