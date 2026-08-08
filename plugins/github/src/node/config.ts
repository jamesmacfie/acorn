// GitHub-only runtime configuration. Keeping this read in the optional plugin means core can boot
// with GitHub disabled and no provider credentials, while the client id never becomes a core/electron
// binding.
export const githubClientId = (): string => process.env.GITHUB_CLIENT_ID?.trim() ?? ''
