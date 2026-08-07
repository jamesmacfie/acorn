// GitHub's per-file `patch` is hunks-only; synthesize a header so gitdiff-parser keys on it.
// Lives in the shared kit rather than the github plugin because the same shape reaches the parser
// from two directions: GitHub's PR file payloads, and `git diff` output trimmed to hunks for the
// changes pane. Sharing rendering code is good; sharing feature internals is what's banned
// (docs/plugins.md § Cross-plugin collaboration).
export const synth = (path: string, patch: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`
