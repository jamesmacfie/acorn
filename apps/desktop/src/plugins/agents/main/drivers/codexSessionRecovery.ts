/**
 * Codex does not write a rollout for a brand-new thread until it receives its first turn. If its
 * app-server process exits during that window, thread/resume reports this exact condition. Acorn
 * may replace only that empty thread; the runtime separately proves no turn may have executed.
 */
export const canReplaceMissingCodexSession = (
  error: unknown,
  noProviderExecutionHistory: boolean,
): boolean =>
  noProviderExecutionHistory
  && error instanceof Error
  && /^no rollout found for thread id(?:\s|$)/i.test(error.message.trim())
