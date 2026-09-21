type ReviewEvent = {
  type?: string
  text?: string
  append?: boolean
  messageId?: string
}

type AssistantMessage = { messageId?: string; text: string }

/** Reconstruct complete assistant messages from the provider's durable append-only event stream. */
export function assistantReviewSummary(events: readonly ReviewEvent[], maxChars = 12_000): string | null {
  const messages: AssistantMessage[] = []
  let previousWasAssistant = false
  for (const event of events) {
    if (event.type !== 'assistant_message' || typeof event.text !== 'string') {
      previousWasAssistant = false
      continue
    }
    const previous = messages.at(-1)
    const sameStream = previous?.messageId === event.messageId
      && (event.messageId !== undefined || previousWasAssistant)
    if (event.append === true && previous && sameStream) {
      previous.text += event.text
    } else {
      messages.push({ ...(event.messageId ? { messageId: event.messageId } : {}), text: event.text })
    }
    previousWasAssistant = true
  }
  const summary = messages.map((message) => message.text.trim()).filter(Boolean).join('\n\n')
  return summary.slice(-maxChars) || null
}
