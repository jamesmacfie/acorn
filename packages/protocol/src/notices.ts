// A bell row a node pushes to its clients, and where clicking it lands.
//
// One shape for both ends of the `workflow:notice` frame: node-core sends it
// (server/notify.ts), client-core folds it into the notice ring
// (features/notifications/deliver.ts). The two used to describe it separately and the node's half
// could only name a workflow run, which is how the memory-proposal gate ended up with a row that
// swallowed the click.
//
// The channel keeps its `workflow:` name for wire compatibility, the same trade `term:status` made.
// Nothing about the payload is workflows' any more.

/** Where a row goes when it is clicked, resolved through the client's handler table
 *  (client-core features/notifications/notifications.ts). `kind` decides who answers, and each owner
 *  registers its own with `registerNoticeTargetHandler`.
 *
 *  Structural rather than a closed union, because the kinds are contributed: core owns `settings` and
 *  `source`, and every other one belongs to the plugin that registers the handler for it. */
export type NoticeTarget = {
  kind: string
  resourceId: string
  subresourceId?: string
}

/** What a plugin passes to `ctx.events.notice`, and what rides the frame.
 *
 *  `taskId` is optional because a notice need not be about a task: a plugin whose setup is incomplete
 *  or whose connection expired is a fact about the node. The client stores `''` for those and skips
 *  the task jump.
 *
 *  `kind` names a registered notice kind, which carries the glyph, the severity and whether the row
 *  may reach the OS (client-core features/notifications/kindContributions.ts). An unregistered one
 *  falls back to `plugin`, so a typo draws a puzzle piece and stays in the bell rather than drawing an
 *  unlabelled circle in warn tone. */
export type PluginNotice = {
  taskId?: string
  title: string
  detail?: string
  kind?: string
  target?: NoticeTarget
}

/** The frame's payload: what the plugin asked for, plus the two fields the host stamps.
 *
 *  `pluginId` is the host's, not the caller's. It is what lets the client resolve a target for the
 *  loaded tier, which never names one (client-core host/plugins/rowTargets.ts).
 *
 *  `runId`/`stepId` are read only as a fallback, for a node built before `target` existed. The
 *  workflows plugin passes a `workflow-run` target now. */
export type NoticeFrame = PluginNotice & {
  pluginId?: string
  action?: 'review-config' | 'review-plugin-request'
  runId?: string
  stepId?: string
}
