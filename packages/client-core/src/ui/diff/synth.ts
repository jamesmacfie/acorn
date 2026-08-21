// GitHub's per-file `patch` is hunks-only; synthesize a header so gitdiff-parser keys on it.
// Shared here rather than in the github plugin because both GitHub's PR file payloads and local
// `git diff` output reach this parser. See docs/diff-rendering.md § Data flow.
export const synth = (path: string, patch: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`
