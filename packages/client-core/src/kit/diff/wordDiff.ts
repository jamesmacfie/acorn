import { diffWordsWithSpace } from 'diff'

export type WordTok = { content: string; kind: 'eq' | 'add' | 'del' }
export type WordDiffInput = { oldText: string; newText: string }
export type WordDiffOutput = { del: WordTok[]; add: WordTok[] }
export type DiffWordsDocument = (pairs: WordDiffInput[]) => Promise<WordDiffOutput[]>

export function wordDiff(oldText: string, newText: string): WordDiffOutput {
  const parts = diffWordsWithSpace(oldText, newText)
  const del: WordTok[] = []
  const add: WordTok[] = []
  for (const part of parts) {
    if (part.added) add.push({ content: part.value, kind: 'add' })
    else if (part.removed) del.push({ content: part.value, kind: 'del' })
    else {
      del.push({ content: part.value, kind: 'eq' })
      add.push({ content: part.value, kind: 'eq' })
    }
  }
  return { del, add }
}

export const wordDiffBatch = (pairs: WordDiffInput[]): WordDiffOutput[] =>
  pairs.map((pair) => wordDiff(pair.oldText, pair.newText))
