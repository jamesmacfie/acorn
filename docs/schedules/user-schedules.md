# User schedules

This page covers schedules the owner creates: the target kinds, how consent is taken and how it fails
closed, workflow schedules, the routes, and Settings → Schedules. Read it before you add a target kind
or change the creation flow. It's part of [schedules](../schedules.md).

## Targets: what a user schedule may do

A user row names a kind and a kind-shaped target. Compiled plugins register target kinds with
`ctx.schedules.registerTarget`, and loaded plugins can't. A row whose kind this build doesn't know
survives inert: it lists, never runs, and says so.

| Kind | What runs |
| --- | --- |
| `node-action` | A plugin action the owner scheduled, dispatched as a POST to that plugin's own route |
| `workflow` | An approved published workflow, through the workflows plugin's durable occurrence ledger |

Dashboard measure sampling isn't a user kind. It's one core schedule over every history panel
([schedules](../schedules.md#sampling-a-published-dashboard)).

### `node-action`

The target is `{ pluginId, actionId, params }`. What runs is the same `runNodeAction` path a click takes:
the plugin's own confined route, POSTed in process with the params as the body. A scheduled fire and a
click are the same to the handler. The schedule owns only when.

What can be scheduled comes from a Node registry with one feeder: manifest commands whose verb is
`runNodeAction`, synthesized by the host (`server/schedules/nodeAction.ts`). There's no descriptor kind
of its own, so the plugin contract didn't grow, and no `ctx` member. The registration reaches the
registry through `HostPluginContext` in `server/pluginHost/types.ts`, which plugins can't reach.

An action that declares no tier is treated as `execute`, the strongest. A chrome action descriptor has
no `risk` field, and "nobody said what this does" isn't a reason to arm the weakest confirmation.

### Consent, and the two ways it fails closed

Consent is taken at creation, whole. The creation flow reads the target's declared tier and draws the
confirmation that tier would get on a click, host-drawn, naming the plugin, with no way to skip it. The
accepted tier is stamped onto the row as `user_schedules.risk`. Runs never prompt after that, because
an unattended prompt is either ignored or auto-accepted. The stamp shows on the settings row for the
schedule's whole life.

- **The tier rises.** A plugin update declaring `execute` where it said `write` invalidates the stamp.
  The run is `skipped` with the reason `risk changed to 'execute' — re-confirm to resume`, and the
  settings row offers the re-arm. A stamp covers the tier it stamped and nothing higher.
- **The target stops resolving.** The plugin is gone or disabled, or the action was renamed. The run is
  `skipped` with the reason, and the row reattaches if the action returns.

Both record `skipped`, not an error, so there's no backoff and no red row. A target says so by throwing
`ScheduleSkipped`.

### `workflow`

The target is `{ scheduleId }`. Core owns the cadence row and calls the workflows plugin through the
target registry. The workflows plugin owns the approved project, published graph, typed inputs, limits,
timezone, processing epoch, and occurrence history ([workflow routes](../api-reference/workflow-routes.md#schedule-bindings)).

An occurrence reserves stable root task and run IDs before either cross-database effect. Its unique
request key covers a manual run, and its generation plus due instant covers a timer run. Restart
reconciliation resumes the missing step with those IDs. A second fire records a skipped occurrence
while any run in the first occurrence's tree is still active or gated.

Approval freezes the resolved root and child graph, published query revisions, inputs, and narrowed
limits. Every dispatch resolves the graph and source destination again before it creates a task. A
changed dependency, revoked connection, missing publication, or untrusted repository moves the schedule
to review instead of starting work. A temporary source failure leaves the reserved occurrence for
backoff or restart reconciliation.

The workflows plugin gives calendar cadences an IANA timezone. A daylight-saving gap skips the missing
local occurrence, and a fold runs the first matching instant once. Pausing stops timer admission and
doesn't cancel an active run tree. **Run now** still admits work for a paused row. Deleting the core row
leaves a workflow-owned tombstone and keeps its task, run, occurrence, and processing history.

The schedule is authored from **Schedule…** on a published database workflow. Setup is progressive:
project, typed inputs, cadence, and timezone first, then record repeat and checkpoint policy for loops
that need it, then the first-check choice, three concrete occurrences, and the effective limits. The
core cadence is created paused and enabled only after approval, or after a track-from-now baseline
succeeds. The device view shows Active, Paused, Needs review, or Unavailable, with repair actions, the
most recent run, and the next occurrence, and leaves out approval digests, epochs, request keys, and
continuation tokens. Editing an approved schedule keeps processing history unless the owner picks
**Start fresh**. The client never queues an activation while disconnected.

## Routes

Every route is behind `requireDevice`, because a schedule is code the Node runs unattended
([core routes](../api-reference/core-routes.md#schedules)). Plugin frames can't reach any of them
(`packages/client-core/src/host/frames/scopes.ts`): reading the list enumerates what the machine does
unwatched, and creating one makes code run later.

Creating is the one strict edge. A create names a target that must resolve at creation, and the risk tier is
read off that target and stamped onto the row. `POST /v1/core/schedules/:key/confirm` takes no body. The
Node stamps again from its own registry, so a client can only accept the tier the host showed.

## Settings

Settings → Schedules is per Node, following the settings header's node switcher, because a schedule is
a promise one machine makes. One list shows the owner badge, the cadence in words, the last run with a
status dot, the next run, the run ring behind a disclosure, and the verbs: pause or resume, run now,
and delete for user rows. A failed schedule shows its error inline, and a backed-off one says when it
will try again. A risky user schedule carries its tier badge.

The creation form has four fields: pick an action, see its tier and accept it, name it, and say when.
The picker offers only what resolves on that Node at that moment. When nothing offers a schedulable action, a
sentence replaces the form. The tier copy uses `ToolRisk`, the same scale agent-tool permissions use,
so a person learns one vocabulary for "how dangerous is this".
