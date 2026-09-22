import type { WordDiffInput, WordDiffOutput } from '../../kit/diff/wordDiff'

export type WordDiffRequest = { id: number; pairs: WordDiffInput[] }
export type WordDiffResponse =
  | { id: number; ok: true; results: WordDiffOutput[] }
  | { id: number; ok: false; error: string }
