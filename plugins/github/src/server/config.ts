// The client ID is public app metadata. Keep the default and optional override in the GitHub
// plugin so core can boot without provider configuration. An explicitly empty override disables
// new connections.
export const githubClientId = (): string => process.env.GITHUB_CLIENT_ID?.trim() ?? 'Ov23liRC5Y5yDF7BTSeg'
