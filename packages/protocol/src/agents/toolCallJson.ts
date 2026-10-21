/** A tool call's input or output as a transcript recorded it, read as JSON. Text that isn't JSON, such
 *  as a pending call's or a failure's, reads as nothing; a result can arrive inside the MCP content
 *  envelope. */
export function toolCallJson(text: string | undefined): unknown {
  try {
    const value: unknown = text ? JSON.parse(text) : undefined
    const content = (value as { content?: { text?: unknown }[] } | undefined)?.content
    return Array.isArray(content)
      ? toolCallJson(content.find((part) => typeof part?.text === 'string')?.text as string)
      : value
  } catch {
    return undefined
  }
}
