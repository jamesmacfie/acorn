# Browser and task script tools

This page covers the browser plugin's tools, which give any agent a browser, and core's task script
tools, which report setup and teardown.

## Browser tools

`plugins/browser` contributes `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`,
`browser_screenshot`, and `browser_console` through the same registry
(`plugins/browser/src/server/agentTools.ts`). They're execute-tier and project to the renderer and to
MCP, so an agent on any Node, headless remote ones included, gets a browser. The plugin ships
`playwright-core` and drives an installed Chrome. Without Chrome, the tools say why they're
unavailable. The plugin is compiled, not loaded, because `playwright-core` has native parts a
hash-addressed bundle can't carry.

The Node keeps at most eight task contexts (`MAX_SESSIONS` in `driver.ts`) and closes the oldest
before opening another. Concurrent requests for one task share its pending allocation. Release
cancels a pending creation, and shutdown waits for late allocations to close. A context that fails to
close keeps its slot until cleanup succeeds or the browser disconnects. Console messages and page
errors share one budget: 200 entries, 8 KiB per entry, and 256 KiB in total.

A screenshot is a row in the plugin's own table, keyed to the task, and the tool returns a URL handle
instead of inline base64, so it outlives the transcript. The plugin keeps the newest 20 per task. It
finishes the insert and the trim before it publishes `plugin:browser:captures-changed { taskId }`.
`browser.captures` lists that task's capture metadata, and pixels stay behind the authenticated
capture route. A task credential reads only its own task's captures. Foreign and unknown IDs both
return an empty 404. The older `capture-created` frame remains for compatibility.

The preview pane and the agent's browser are separate on purpose. The preview is a child webview that
only you drive ([host-owned webviews](../shell/webviews.md)). To see what you see, the agent points
its own browser at the same URL.

## Task script tools

Core registers three read-tier tools, scoped to the authenticated task:

- `task_scripts_status {}` returns both phases and bounded attempt summaries.
- `task_scripts_wait { phase, timeoutMs, attemptId? }` waits at most 30,000 ms for the attempt and
  generation. A timeout returns `matched: false` and doesn't cancel the process.
- `task_scripts_logs { phase, tailLines, maxBytes?, attemptId? }` returns bounded output with
  availability and truncation fields, 100 lines by default.

`phase` is `setup` or `teardown`, and inputs can't select another task. All three call the same
service as the core task API and the CLI, and none starts setup or creates a worktree. Before work
that needs installed dependencies, read setup status again, and wait for an attempt that's starting
or running. A script's success doesn't prove the environment is ready.

`task_current` includes a compact snapshot of both phases. Launch context is a snapshot, so use the
tools for the current state. Older tasks with no trustworthy history stay `unknown`.
[Task script results](../workspaces-and-tasks/task-scripts.md) has the states.
