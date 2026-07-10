import { integrationProviderRegistry } from '../registry'
import { linear } from '../../routes/linear'
import { rollbar } from '../../routes/rollbar'
import { githubProvider } from './github'
import { linearProvider } from './linear'
import { rollbarProvider } from './rollbar'

export const builtInIntegrationProviders = [githubProvider, linearProvider, rollbarProvider] as const

for (const provider of builtInIntegrationProviders) integrationProviderRegistry.register(provider)

integrationProviderRegistry.registerRoute({ providerId: 'linear', prefix: '/linear', router: linear })
integrationProviderRegistry.registerRoute({ providerId: 'rollbar', prefix: '/rollbar', router: rollbar })
