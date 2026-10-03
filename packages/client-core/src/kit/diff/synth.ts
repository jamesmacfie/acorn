// GitHub's per-file `patch` is hunks-only; the diff document's parser puts a header in front of it
// for gitdiff-parser. Re-exported here because the toolkit has always offered it, and a test that
// builds a local patch fixture reaches for it (docs/diff-rendering/document.md § Data flow).
export { synth } from '@acorn/diff-document/document'
