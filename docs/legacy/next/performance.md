# Performance follow-ups

The current product already uses Node-side serve-then-revalidate caches, bounded provider reads,
virtualized diffs, client query persistence, stream backpressure, and renderer size budgets.

Future performance work should begin with measurements from boot marks, storage-footprint logs,
renderer budgets, query timings, and targeted large-diff captures. Do not add broad telemetry or
retention sweeps without evidence of a user-visible problem.
