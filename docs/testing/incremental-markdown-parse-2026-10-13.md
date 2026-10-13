# Markdown parse cost check, October 13, 2026

This page records the measurement that decided
[incremental Markdown](../future/ui-performance/03-incremental-markdown.md). The gate is a 95th
percentile under 2 ms for `renderBlocks` at the end of a 50 KB streamed reply. In plain Node, the
95th percentile was 0.94 to 1.46 ms, so the stateful renderer was not built.

This is a proxy, not a real-window number. `renderBlocks` is pure string work with no DOM, so jsdom
adds nothing over plain Node. Node runs it in V8, while the desktop window runs it in WebKit's
JavaScriptCore, which can be slower on this regular-expression-heavy code. A person still needs to
take the real-window numbers listed at the end of this page.

## Machine and run

- Host: macOS on an Apple M2 Pro, Node v24.11.0, at base `5d9807c6e`.
- The machine was busy. The load average was 38 during the runs, which spreads the high
  percentiles.
- Input: the `prose` fixture from `apps/desktop/scripts/agent/replay-fixtures.mjs`, seed 1. Only
  its `agent_message_chunk` text counts, because reasoning renders as a separate message. The
  final reply is 71,064 characters in 240 chunks.
- Method: append one chunk at a time and time one `renderBlocks(text, {})` call after each, the
  same call `Markdown` makes under `markdown.parse`. Each chunk stands for one streamed frame,
  because the fixture's 40 ms delay matches the Node's text coalescing. The first pass of each run
  warms up and isn't counted.

The script:

```js
import { replayFixture } from './apps/desktop/scripts/agent/replay-fixtures.mjs'
import { renderBlocks } from './packages/client-core/src/kit/lib/rendering/markdown.ts'

const chunks = replayFixture('prose').updates
  .filter((u) => u.sessionUpdate === 'agent_message_chunk')
  .map((u) => u.content.text)
const near = []
for (let run = 0; run < 30; run++) {
  let text = ''
  for (const chunk of chunks) {
    text += chunk
    if (text.length > 51200) break
    const start = performance.now()
    renderBlocks(text, {})
    if (run > 0 && text.length >= 46080) near.push(performance.now() - start)
  }
}
```

## Results

The gate window covers updates from 45 KB to 50 KB, 522 timed updates per run:

| Run | Median | 95th percentile | 99th percentile |
| --- | --- | --- | --- |
| 1 | 0.79 ms | 0.94 ms | 1.04 ms |
| 2 | 0.80 ms | 1.07 ms | 1.57 ms |
| 3 | 0.82 ms | 1.46 ms | 3.15 ms |
| 4 | 0.80 ms | 0.97 ms | 1.14 ms |
| 5 | 0.80 ms | 0.98 ms | 1.19 ms |

The cost grows in a straight line with the message, about 16 microseconds per KB at the median.
Over the whole 71 KB reply, three runs gave a 95th percentile of 1.15 to 1.22 ms. Updates past
65 KB had a 95th percentile of 1.4 to 1.9 ms. One parse per frame for the whole reply adds up to
about 150 ms of main-thread time over its roughly 10 seconds of streaming.

## Measurements still required

Run the `prose` fixture in a visible window, twice with telemetry on, as described in
[streaming replay](../local-development/streaming-replay.md#run-one-fixture):

```sh
pnpm dev:agent -- --session replay-on --fixture streaming-replay --telemetry on --seed 1
pnpm dev:agent:ui -- --session replay-on replay prose
```

From the `streaming` phase of each report, record these numbers:

- The `markdown.parse` row's `p95`, `p50`, `max`, `count`, and `sum`.
- The `markdown.parse.characters` row's `max`, which shows the message reached about 71 KB.
- The `markdown.render` row's `p95`, for the whole per-frame cost around the parse.

The phase report pools every update in the reply, from the first character to 71 KB. Its `p95`
therefore sits near the cost at about 67 KB, which is above the 50 KB gate point. If that `p95`
stays under 2 ms, the gate holds in the real window too. If it goes over, build the change the
phase doc describes.
