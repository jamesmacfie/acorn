import { ProviderOperationError } from '../types'
import { defaultBudgets, externalIdsFor, publicProvider } from './shared'

export const githubProvider = publicProvider({
  id: 'github',
  label: 'GitHub',
  glyph: '◇',
  kind: 'identity',
  connection: {
    authKind: 'github-session',
    fields: [],
    connectable: false,
    disconnectable: false,
    async validate() {
      throw new ProviderOperationError('provider_bad_config', 400)
    },
    normalize() {
      throw new ProviderOperationError('provider_bad_config', 400)
    },
    async test() {
      return { ok: true }
    },
  },
  externalIds: externalIdsFor('github'),
  capabilities: { repoAffinity: 'intrinsic' },
  resources: [],
  budgets: defaultBudgets,
  memory: { linkedItems: false, mutations: [], triggers: [], summarize: 'none', acceptedWrites: false },
})
