import type { AgentWebAction } from '@acorn/protocol/managedAgents.ts'

/**
 * The one thing about a web call that must not differ by harness: what the row is called.
 *
 * Providers each write their own: Codex sends no title at all, and Claude Code's adapter sends the
 * query in quotes with its domain filters appended. Both used to reach the transcript, so the same
 * activity read as two different things depending on which executable ran it. The action is what
 * happened, so the action names the row and the query goes in the card where a long one can wrap.
 *
 * Shared between drivers rather than owned by one, because a second driver importing the first is
 * how a provider name ends up somewhere it does not belong. A future harness maps its own wire shape
 * to `AgentWebAction` and gets the title from here (docs/managed-agents.md § Web activity).
 */
const WEB_TITLES: Record<AgentWebAction['type'], string> = {
  search: 'Search web',
  open_page: 'Open page',
  find_in_page: 'Find on page',
  fetch_page: 'Fetch page',
  other: 'Web activity',
}

/** Undefined means the provider has opened a call and not yet said what it is: Codex's start
 *  notification carries an empty query and two nulls. The action's type rather than the action, so a
 *  driver that knows what its tool does before the request lands can name the row anyway. */
export const webToolTitle = (action: AgentWebAction['type'] | undefined): string =>
  action ? WEB_TITLES[action] : 'Web search'
