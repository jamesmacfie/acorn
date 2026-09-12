// The last gate before the network.
//
// Core scrubs at the ingest door: a log body, an error message, an error stack and every string
// attribute go through `scrub` on the way into the ring, and a batch posted by another runtime is
// re-scrubbed on arrival (docs/telemetry.md § What never leaves the machine). So this pass is not
// cleaning up after core. It is the check a sink owes, and it covers the strings core takes on
// trust as patterns rather than as content: a span's name, a metric's name, an event's name, a
// logger tag. Those are supposed to be `http.request` and `schedules`. A plugin that puts a path or
// a token in one is the case this catches, and this is the only place left to catch it.
//
// `scrub` is imported rather than copied. There are already two copies of those token patterns in
// this repository and each header says a change belongs in both; a third, inside the plugin whose
// whole job is egress, is the copy that would rot without anyone noticing.
import { scrub, type TelemetryAttrs, type TelemetryBatch, type TelemetryRecord } from '@acorn/plugin-api/node'

/** A name is a pattern. Anything longer is not one, whatever else it is. */
const NAME_MAX = 128
/** The cap core applies to an attribute value, applied again here. */
const ATTR_MAX = 512

const name = (value: string): string => scrub(value, 'unnamed', NAME_MAX)

function attrs(source: TelemetryAttrs, taskIds: boolean): TelemetryAttrs {
  const out: TelemetryAttrs = {}
  for (const [key, value] of Object.entries(source)) {
    // The owner's choice on the settings page. A task id is the one attribute that points at a
    // particular piece of the owner's work rather than at a shape of it.
    if (!taskIds && key === 'task.id') continue
    out[key] = typeof value === 'string' ? scrub(value, '', ATTR_MAX) : value
  }
  return out
}

/** One record, safe to serialise. Never throws: `scrub` answers with its fallback rather than
 *  raising, because telemetry must not fail the thing it describes. */
export function redactRecord(record: TelemetryRecord, options: { taskIds: boolean; stacks: boolean }): TelemetryRecord {
  const clean = attrs(record.attrs, options.taskIds)
  if (record.kind === 'span') return { ...record, name: name(record.name), attrs: clean }
  if (record.kind === 'event') return { ...record, name: name(record.name), attrs: clean }
  if (record.kind === 'metric') return { ...record, name: name(record.name), attrs: clean }
  if (record.kind === 'log') return { ...record, logger: name(record.logger), body: scrub(record.body), attrs: clean }
  // Destructured rather than overwritten, so "no stacks" removes the key instead of setting it to
  // `undefined`, which `JSON.stringify` would keep out of the envelope but the type would not.
  const { stack, ...rest } = record
  return {
    ...rest,
    ...(options.stacks && stack ? { stack: scrub(stack) } : {}),
    name: name(record.name),
    message: scrub(record.message),
    attrs: clean,
  }
}

export const redactBatch = (batch: TelemetryBatch, options: { taskIds: boolean; stacks: boolean }): TelemetryBatch => ({
  ...batch,
  records: batch.records.map((record) => redactRecord(record, options)),
})
