import { Hono } from 'hono'
import { postedTelemetryBatchSchema, TELEMETRY_BATCH_MAX_BYTES } from '@acorn/protocol/telemetry.ts'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { ingestTelemetry, telemetrySummary } from '../telemetry/collector'

// Where every runtime that is not the node posts its records (docs/telemetry.md § Other runtimes).
// The renderer today, the terminal client and the desktop helper next.
//
// Device-only, mounted with `requireDevice` in server/index.ts. A task-scoped internal token must
// not be able to put records into a stream a sink will send off this machine: a plugin holding the
// `telemetry` token reads everything, and the trust prompt draws that high on the promise that what
// it reads came from acorn rather than from whatever an agent decided to write.
//
// A batch is write-only from the caller's side; what happens to it after is the collector's and the
// sink's. The one read here is the summary Settings draws, which is counters and never records.

export const telemetry = new Hono<AppEnv>().post('/', async (c) => {
  // Read before parsing, so an oversized body is refused on its length rather than after the JSON
  // parser has built the whole thing in memory. `content-length` is the broker's own header on the
  // desktop path and the sender's everywhere else, so the text is measured too: a lying header
  // would otherwise be the way past this.
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > TELEMETRY_BATCH_MAX_BYTES) return respondError(c, 413, 'request_too_large')
  const text = await c.req.text().catch(() => '')
  if (new TextEncoder().encode(text).byteLength > TELEMETRY_BATCH_MAX_BYTES) return respondError(c, 413, 'request_too_large')

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return respondError(c, 400, 'bad_request')
  }
  const parsed = postedTelemetryBatchSchema.safeParse(body)
  // Refused whole. A batch with one malformed record in it is a caller with a bug, and admitting the
  // rest would hide it behind records that happen to parse.
  if (!parsed.success) return respondError(c, 400, 'bad_request')

  // `runtime` is re-stamped onto every record from the parsed batch, which cannot say `node`. The
  // caller's own attributes are dropped in `cleanAttrs`, so a record arriving with `runtime: 'node'`
  // on it loses that here rather than reaching a sink dressed as one of this process's own.
  const accepted = ingestTelemetry(parsed.data.runtime, parsed.data.records)
  // 202 whether or not anything was kept. Zero means the preference is off or no sink is subscribed,
  // and that is not the caller's failure to handle: it reads the preference on its own tick and
  // stops posting on its own.
  return c.json({ accepted }, 202)
})
  // What Settings → Telemetry draws (docs/telemetry.md § What the page shows). Device-only along
  // with the rest of this router: the list of sinks names which plugins on this machine read the
  // stream, which is a fact about the installation rather than about a task.
  .get('/summary', (c) => c.json(telemetrySummary()))
