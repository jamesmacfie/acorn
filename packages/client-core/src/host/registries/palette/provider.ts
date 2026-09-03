import { hasHostCapability } from '../../../infra/node/hostCapabilities'
import { COMMAND_CLOSED, type CommandOutcome } from '../commands/commands'
import type { SessionRow, SessionRowBatch, SessionRowProvider } from '../commands/session'
import { paletteRowSources } from './paletteRows'

// `paletteRows` contributions, as one row provider for the palette session.
//
// A compatibility adapter, and it is meant to be temporary: every source behind it becomes a command
// during phases 4 and 5, and this file and `./paletteRows.ts` go together when the census reaches
// zero (docs/future/command-palette/phase-6-cutover-and-documentation.md). Until then it is the one
// place either host asks a source for rows, which is one fewer than before — the desktop and the
// terminal each had their own copy of the fetch, the error wrapping and the row-to-source map.
//
// The map is gone with it. A row carries the call back to its own source in its `run`, so nothing
// downstream has to remember who produced which id.

/** Before the commands, which is where the flat list put them. */
export const PALETTE_ROWS_ORDER = 100

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Every eligible source, in parallel, with one failing source contributing an error line rather than
 * taking the list down.
 *
 * That reasoning is the desktop's, unchanged: a broken run-target fetch must not also hide the
 * workflow rows, the pane commands and go-to-task. One provider over all the sources rather than one
 * each, so a single fetch generation keeps the list consistent.
 */
export function createPaletteRowsProvider(): SessionRowProvider {
  return {
    id: 'palette-rows',
    order: PALETTE_ROWS_ORDER,
    rows: async (context): Promise<SessionRowBatch> => {
      const eligible = paletteRowSources().filter((source) => hasHostCapability(source.requires))
      const taskId = context.taskId
      const results = await Promise.all(eligible.map(async (source) => {
        try {
          return { source, result: await source.rows(taskId) }
        } catch (error) {
          return { source, result: { rows: [], errors: [{ source: source.id, message: messageOf(error) }] } }
        }
      }))
      return {
        rows: results.flatMap(({ source, result }) => result.rows.map((item): SessionRow => ({
          id: item.id,
          label: item.label,
          hint: 'hint' in item ? item.hint : undefined,
          action: {
            effect: 'run',
            // The source's own answer, back to the source. A `{ error }` result becomes a rejection so
            // that it reaches the reader: the session keeps the frame open on an error, where the flat
            // palette closed first and then wrote the message into a surface nobody could see.
            run: async (invoked): Promise<CommandOutcome> => {
              const outcome = await source.invoke(item, invoked.taskId)
              if (outcome?.error) throw new Error(outcome.error)
              return COMMAND_CLOSED
            },
          },
        }))),
        errors: results.flatMap(({ result }) => result.errors ?? []),
      }
    },
  }
}
