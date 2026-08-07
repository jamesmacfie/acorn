// How fast github's mirrored data goes stale. Moved out of @acorn/node-core/server/sync/policy.ts,
// where core was deciding it for a provider it knows nothing about (finding 8).
//
// The two numbers are a judgement about GitHub, and belong with the code that talks to GitHub: a PR's
// list, detail and file set change while someone is reviewing, and repo metadata does not.
export const PULLS_STALE_AFTER_MS = 45_000
export const REPOS_STALE_AFTER_MS = 300_000
