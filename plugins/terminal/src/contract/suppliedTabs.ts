// Read-only tabs another plugin puts in a task's terminal strip (docs/plugins/supplied-terminal-tabs.md).
//
// A contract file rather than client/, so a supplier gets this and nothing of the terminal's own
// surface: no write, attach, resize or kill of any session.
//
// A client capability rather than an extension point. A tab's body is a live `PtyIo`, and a function
// can't cross to a plugin that runs in a worker, so only a compiled plugin can supply one. The key
// lives here because the terminal can't import its one supplier, and the id names that supplier.
import { clientCapabilityId } from '@acorn/plugin-api/client'
import type { PtyIo } from '@acorn/plugin-api/ui'

export type TerminalSuppliedTab = {
  /** Unique within the task, and never a terminal session's id. */
  id: string
  title: string
  /** Drawn on the tab so it reads apart from a shell. `label` is what a screen reader says for it. */
  icon?: { name: string; label: string }
  /** The body. The strip draws it with the host's terminal view. Its `input` and `resize` are never
   *  meant to reach anything, because the tab is read-only. */
  io: PtyIo
}

export type TerminalTabSupplier = {
  /**
   * The task's tabs, in the order to draw them. Read in a tracking scope, so the strip follows them.
   * `loaded` is false until the supplier has first heard about the task, so the strip can hold a
   * request to show a tab it doesn't have yet.
   */
  tabs(taskId: string): { loaded: boolean; tabs: readonly TerminalSuppliedTab[] }
}

export const TERMINAL_TAB_SUPPLIER = clientCapabilityId<TerminalTabSupplier>('agents.terminalTabs')
