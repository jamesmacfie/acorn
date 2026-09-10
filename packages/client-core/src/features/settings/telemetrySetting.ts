import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { savePref } from './savePref'

// The one telemetry switch, as a reader and a writer (docs/telemetry.md § The switch).
//
// Two places read it, so it is a function rather than an inline `prefs?.[key] === '1'` in each: the
// Settings page draws it, and `App.tsx` turns the client's emitter on and off with it. The same rule
// `./appearancePrefs.ts` states, that a setting a person can change from two places has one accessor.
//
// A node preference and not a device one. The collector runs on the node and re-reads this row every
// five seconds, so turning it off in one window stops every client paired with that node, which is
// what "nothing leaves this machine that you did not agree to" has to mean.

/** Off unless the row says `'1'`, which is the same reading the node's collector does. */
export const telemetryOn = (prefs: Record<string, string> | undefined): boolean => prefs?.[PrefKeys.telemetry] === '1'

export const saveTelemetryOn = (qc: QueryClient, on: boolean): Promise<boolean> =>
  savePref(qc, PrefKeys.telemetry, on ? '1' : '0')
