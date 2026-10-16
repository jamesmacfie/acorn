// The OAuth application's client id is public metadata, read from the environment as GitHub reads
// `GITHUB_CLIENT_ID`. With none set, the device flow is off and a personal access token is the only
// way in. Acorn's own gitlab.com application still has to be registered, with the device
// authorization grant on and the `api` scope.
export const gitlabClientId = (): string => process.env.GITLAB_CLIENT_ID?.trim() ?? ''

// gitlab.com only. Self-hosted servers add their hosts at runtime (docs/future/github/06-self-hosted-hosts.md).
export const GITLAB_ORIGIN = 'https://gitlab.com'
export const GITLAB_HOST = 'gitlab.com'
