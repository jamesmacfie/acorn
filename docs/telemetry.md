# Telemetry

This page is the map of acorn's telemetry: five kinds of record, one switch that's off by default, and
a stream a plugin can subscribe to and ship anywhere. Read it to find the page that owns a seam, a
limit, or a sink.

Every record says which plugin or which part of core caused it, so "why is this slow" and "whose
fault is this" are one query. The Node is the only collector. The renderer, the terminal client, the
desktop helper, and the Rust shell collect and post what they collect to the Node. Nothing leaves the
machine unless the owner turns the switch on and a sink is subscribed.

## Pages

[The telemetry model](./telemetry/model.md) covers the switch, the five kinds, the span admission
rule, histogram series limits, attributes, what never leaves the machine, and traces.

[Plugins and sinks](./telemetry/plugins-and-sinks.md) covers writing telemetry from a plugin or a
frame, writing a sink, and the Sentry sink.

[Telemetry runtimes](./telemetry/runtimes.md) covers the collector, ambient attribution, every Node
seam, the crash handler, and how the terminal client, helper, and shell post.

[Node boot](./telemetry/node-boot.md) covers the Node's boot as `node.boot` spans, its marks, and
when they're sent.

[Renderer telemetry](./telemetry/renderer.md) covers the renderer's emitter, one trace per
interaction, contribution owners, and every renderer seam.

[Logging](./telemetry/logging.md) covers the two loggers, the `console.*` architecture rule, and
the shape of a log line.

[Rendered-surface health](./telemetry/surface-health.md) covers the numbers a large diff or timeline
keeps about itself and how to read them.

[Diagnosis](./telemetry/diagnosis.md) covers what Settings → Telemetry shows, diagnosing an
unresponsive view, memory over a day, and the deliberate limits.

## Related pages

- [Plugin authoring](./plugin-authoring/telemetry.md) owns the verbs a plugin author
  calls.
- [The node realm](./security/plugin-node-realm.md#telemetry-sinks) owns why the sink grant is drawn
  high.
- [Profiling](./local-development/profiling.md#timing-a-cold-start) owns the `ACORN_PERF=1` switch
  that prints to a terminal instead.
- [State ownership](./state-ownership.md#node-owned-state) owns why the switch belongs to the Node.
