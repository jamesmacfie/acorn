import { createEffect, createMemo, on, type Accessor } from 'solid-js'
import type { NodeReadiness } from '@acorn/client-core/infra/node/activeNode.ts'
import { emitError } from '@acorn/client-core/infra/telemetry/emitter.ts'
import type { ClientPluginsState } from './activate'

// Which part of a launch holds the window, and what to say about it
// (docs/frontend/data-and-startup.md § Startup readiness).
//
// The work overlaps: the roster registers while the Node starts, and the cache reads while both run.
// This module doesn't order that work. It reads where each part is and names the first one still
// holding progress, so the same inputs always give the same message. A failure wins over anything
// pending, because waiting won't fix it and the person can act on it now.

export type StartupFailureStep = 'node' | 'registration' | 'reads'

export type StartupStage =
  | { kind: 'connecting' } // the helper is choosing a Node
  | { kind: 'starting' } // the supervised local Node hasn't reported its first status
  | { kind: 'unpaired' } // the fleet has no Node to choose
  | { kind: 'preparing' } // the compiled roster is importing and registering
  | { kind: 'reading-cache' } // the saved query cache is loading from disk
  | { kind: 'restoring' } // saved state is hydrating and the shell is choosing where to land
  | { kind: 'offline' } // the Node is offline and this device has nothing cached to show
  | { kind: 'failed'; step: StartupFailureStep; error: unknown }
  | { kind: 'ready' }

export type StartupInputs = {
  node: NodeReadiness
  /** The selected Node is the supervised local one and hasn't reported a status yet. */
  nodeStarting: boolean
  nodeOffline: boolean
  plugins: ClientPluginsState
  cacheRestoring: boolean
  /** Hydration and destination selection have both settled. */
  restored: boolean
  /** A list the restore needs is missing. */
  readsMissing: boolean
  /** The first read error among the missing lists, once one has failed. */
  readError: unknown
}

export function startupStage(input: StartupInputs): StartupStage {
  if (input.node.kind === 'failed') return { kind: 'failed', step: 'node', error: input.node.reason }
  if (input.plugins.kind === 'failed') return { kind: 'failed', step: 'registration', error: input.plugins.error }
  if (input.node.kind === 'unpaired') return { kind: 'unpaired' }
  if (input.node.kind === 'starting') return { kind: 'connecting' }
  if (input.nodeStarting) return { kind: 'starting' }
  if (input.plugins.kind === 'pending') return { kind: 'preparing' }
  if (input.cacheRestoring) return { kind: 'reading-cache' }
  if (input.restored) return { kind: 'ready' }
  // An offline Node can't answer, so there's no point waiting for its reads to fail.
  if (input.readsMissing && input.nodeOffline) return { kind: 'offline' }
  if (input.readsMissing && input.readError !== undefined)
    return { kind: 'failed', step: 'reads', error: input.readError }
  return { kind: 'restoring' }
}

/** Whether the stage holds the whole window, rather than only the content region beside the rail. */
export const stageHoldsShell = (stage: StartupStage): boolean =>
  stage.kind === 'connecting' ||
  stage.kind === 'starting' ||
  stage.kind === 'unpaired' ||
  stage.kind === 'preparing' ||
  stage.kind === 'reading-cache' ||
  (stage.kind === 'failed' && stage.step !== 'reads')

export function startupMessage(stage: StartupStage): string {
  switch (stage.kind) {
    case 'connecting':
      return 'Connecting to your computer…'
    case 'starting':
      return "Starting Acorn's services…"
    case 'unpaired':
      return 'Not connected yet'
    case 'preparing':
      return 'Preparing your workspace…'
    case 'reading-cache':
    case 'restoring':
      return 'Restoring your workspace…'
    case 'offline':
      return 'Your computer is offline'
    case 'failed':
      return "Acorn couldn't finish loading"
    case 'ready':
      return ''
  }
}

export const failureText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const sameStage = (a: StartupStage, b: StartupStage): boolean =>
  a.kind === b.kind && (a.kind !== 'failed' || (b.kind === 'failed' && a.step === b.step && a.error === b.error))

/**
 * The window's one startup coordinator. It reports each failure once, with the step that failed and
 * nothing unbounded in its attributes. Detail stays in the message and stack.
 */
export function createStartupStage(
  inputs: Accessor<StartupInputs>,
  onStopped: (step: StartupFailureStep | 'offline') => void,
): Accessor<StartupStage> {
  const stage = createMemo(() => startupStage(inputs()), undefined, { equals: sameStage })
  createEffect(
    on(stage, (current) => {
      if (current.kind === 'offline') onStopped('offline')
      if (current.kind !== 'failed') return
      onStopped(current.step)
      const error = current.error
      emitError('core', {
        name: error instanceof Error ? error.name || 'Error' : 'StartupError',
        message: failureText(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        level: 'error',
        handled: true,
        attrs: { seam: 'renderer.startup', 'startup.step': current.step },
      })
    }),
  )
  return stage
}
