# Tracker and GitHub tools

These tools let an agent read and comment on the issues and errors linked to its task, and work with
its pull request. Core owns the tracker tools, and each provider owns the reads and writes behind them.
The GitHub plugin owns its three tools.

## GitHub

`github_pull_create` is write-tier. It's available only to a managed session on a task with a GitHub
project and a branch. It creates the pull request from that branch, records the session in core's
task pull request relation, and returns whether the pull request became primary or related.

`pr_review_comments` and `pr_checks` are read-tier. Both read the mirror the GitHub plugin keeps fresh,
so neither spends a credential or touches the network. `pr_review_comments` groups the mirror's
`review_threads` rows into threads and leaves resolved ones out unless asked. `pr_checks` returns every
check with its raw status and the failing names, by the rule the ci-loop step uses (`checkFailed` in
`plugins/github/src/server/mirrorQueries.ts`). Both say in a `status` field whether the pull request
is unmirrored, because an unmirrored pull request isn't one with no feedback or a green one.

Core's `pr_current` and `pr_changed_files` read the task's primary pull request.

## issue_detail

`linked_issues` lists what's attached to the task, with the bounded items from the `issues` context
section: provider, label, and cached status. That isn't enough to implement a ticket or fix an error,
which need the description, the comments, or the trace.

`issue_detail` takes an identifier, an optional provider, and an optional `refresh`, asks each
connected workspace in turn, and returns the first answer. It's read-tier.

Core owns the tool, and the provider owns the read. One shared name searches every connected provider,
which a plugin's own loaded tool can't do. A provider declares `detail` on its provider contribution,
a function core calls once per connection with one method lent to it:

```ts
export type ProviderDetailContext = {
  resource<TInput, TOutput>(resourceId: string, input: TInput, force?: boolean): Promise<RouteResult<TOutput>>
}
export type ProviderItemDetail = (context: ProviderDetailContext, identifier: string) => Promise<unknown | null>
```

That method is the resource runtime the provider's own routes use, with the same cache, TTL, request
budget, and credential scope. The provider composes its own resources: Linear reads the issue, and
Rollbar reads the item, its occurrences, and the newest occurrence, which holds the trace.

Three answers stay apart. A value is the item. `null` means "not in this connection", which most
workspaces say. A throw is that workspace refusing, and core reports it instead of not-found, because a
401 from the owning workspace isn't "no such ticket". Naming a provider that declares no `detail` is a
`bad_request`, and when no provider declares one, the tool's `when` hides it.

## issue_comment and issue_image

`issue_comment` posts a comment on an issue and is write-tier. `issue_image` returns one image from an
issue, such as a screenshot in a Linear ticket, and is read-tier. Both are in
`packages/node-core/src/server/agentTools/issueTools.ts`, and each provider owns the call through its
`comment` or `image` hook ([integrations](../integrations.md)).

Both act only on an item linked to the task, and the link names the connection. So an agent can't
comment on a ticket nobody attached, or use your key to read files from one. An unlinked identifier is
`not_found`, and the message tells the agent to ask you to link it.

`issue_comment` also checks the capability the connection was granted, which can be narrower than what
the provider offers. It passes the tool call ID to the hook as `idempotencyKey`. After a post, it
refreshes the item's cached detail in the background. The comment appears under the name of the
person who connected the tracker, and the tool description says so.

`issue_image` accepts a URL only if it appears in the item's detail. It accepts PNG, JPEG, GIF, and
WebP up to 5 MB. Its result is a `ToolImageResult` (`packages/protocol/src/transport/api/taskSupport.ts`), which
the MCP server returns as an image block. It's the only tool result the MCP server treats differently.
