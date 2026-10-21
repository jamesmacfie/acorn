# How an app's program runs

This page covers when the runtime evaluates an app's program and runs its queries. Read it before you
change `packages/openui-solid/src/runtime.ts` or a component that reads a `$` variable. It's part of
[agent-built apps](../agent-built-apps.md).

The runtime evaluates a program once per animation frame, from whatever the variables hold then.
Several writes in one frame make one evaluation, and a component that didn't change keeps its element.
A hidden window gets no frames, so a 50 ms timer runs the evaluation too. A program change evaluates at
once.

A field reads its own value without waiting for the evaluation, so typing draws on the keystroke. The
program's other text that reads the variable follows within a frame.

A query whose arguments changed runs again 250 ms after the last change, so a query bound to an input
sends one request when typing pauses, not one per key. A button's `Set`, `Reset`, or `Run` step runs
the queries first, so the step sees the current arguments and a `Run` step never re-runs a query with
arguments the field has already left behind.
