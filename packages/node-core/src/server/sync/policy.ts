export const PULLS_STALE_AFTER_MS = 45_000 // PR list + PR detail + PR files — "fast-changing"
export const REPOS_STALE_AFTER_MS = 300_000 // repo metadata — "slow-changing"
export const ROLLBAR_ITEMS_STALE_AFTER_MS = 120_000 // Rollbar items — errors move fast
export const LINEAR_ISSUES_STALE_AFTER_MS = 600_000 // Linear issues — tickets change slower than PRs

export const RATE_LIMIT_BACKOFF_MS = 60_000
