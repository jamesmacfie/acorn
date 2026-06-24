import type { PullFile } from '../../queries'
import { buildDiffRows, type ParsedFile, type TokenizeLine } from './model'

type ChunkedParseOptions = {
  chunkSize?: number
  isCancelled?: () => boolean
  onChunk: (parsed: ParsedFile[]) => void
  yieldToMain?: () => Promise<void>
}

export const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function parseFilesInChunks(files: PullFile[], tokenize: TokenizeLine, options: ChunkedParseOptions): Promise<boolean> {
  const chunkSize = options.chunkSize ?? 10
  const shouldStop = () => options.isCancelled?.() ?? false
  const pause = options.yieldToMain ?? yieldToMain
  const acc: ParsedFile[] = []

  for (let i = 0; i < files.length; i += chunkSize) {
    if (shouldStop()) return false
    for (const file of files.slice(i, i + chunkSize)) acc.push({ file, diff: buildDiffRows(file, tokenize) })
    if (shouldStop()) return false
    options.onChunk([...acc])
    await pause()
  }
  return true
}
