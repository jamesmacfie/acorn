import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'

export type TerminalLaunchContext = {
  /** Returns an optional bounded text block for a new agent session. */
  read(taskId: string): Promise<string | null>
}

export const TERMINAL_LAUNCH_CONTEXT = extensionPointId<TerminalLaunchContext>('terminal:launch-context')
