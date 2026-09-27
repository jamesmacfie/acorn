import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'

/** The next step shared by model-backed plugin actions. Feature-specific failures stay with callers. */
export function modelProviderFailure(
  error: unknown,
  backend?: Pick<ModelBackend, 'kind' | 'label'>,
): string | undefined {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  switch (code) {
    case 'provider_needs_auth':
      return 'The provider key was rejected. Reconnect it in Settings, under Integrations.'
    case 'provider_not_connected':
      return 'That provider is no longer connected. Pick another, or add one in Settings, under Integrations.'
    case 'provider_rate_limited':
      return 'The provider is rate-limiting requests. Try again shortly.'
    case 'provider_unavailable':
      return backend?.kind === 'harness'
        ? `${backend.label} did not answer. Run it once in a terminal to check it is signed in.`
        : 'The provider did not answer. Try again shortly.'
    default:
      return undefined
  }
}
