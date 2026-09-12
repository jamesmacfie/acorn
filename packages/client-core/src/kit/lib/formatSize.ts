// Byte/token size formatting shared by any pane that shows a context budget.
//
// Sizes are bytes end-to-end (budgets are byte-based; no tokenizer exists). ~tokens = bytes/4,
// marked "~". Lives in core/client/lib rather than a feature folder because both the context pane
// and the notes pane render the same size text. A plugin importing another plugin's model just to
// format a byte count is the coupling this seam exists to avoid.
export const bytesOf = (s: string): number => new TextEncoder().encode(s).byteLength

const approxTokens = (bytes: number): number => Math.round(bytes / 4)

const formatTokens = (tokens: number): string => (tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`)

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB · ~${formatTokens(approxTokens(bytes))} tok`
}
