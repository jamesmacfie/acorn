// GitHub's per-file `patch` is hunks-only; synthesize a header so gitdiff-parser keys on it.
export const synth = (path: string, patch: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`
