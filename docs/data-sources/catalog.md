# Source catalog

Every data source the Node serves out of the box, which plugin owns it, and where its fields and
limits are documented. Read [data sources](../data-sources.md) for the contract they share. When you
add a source, add its row here.

| Source | Owner | One record per | Starters | Reference |
| --- | --- | --- | --- | --- |
| Tasks (`core:tasks`) | Core | Task in the workspace | Yes | [Data sources](../data-sources.md) |
| Local branches (`core:local-branches`) | Core | Local branch of a project | No | [Data sources](../data-sources.md) |
| Local worktrees (`core:local-worktrees`) | Core | Worktree of a project | Yes | [Data sources](../data-sources.md) |
| Managed agent sessions (`agents:sessions`) | Agents | Unarchived session | No | [Turn facts](../managed-agents/turn-facts.md#data-sources) |
| Agent usage records (`agents:usage-records`) | Agents | Usage report | Yes | [Turn facts](../managed-agents/turn-facts.md#data-sources) |
| Agent turns (`agents:turns`) | Agents | Finished turn | Yes | [Turn facts](../managed-agents/turn-facts.md#data-sources) |
| Agent session totals (`agents:session-totals`) | Agents | Session with a finished turn | Yes | [Turn facts](../managed-agents/turn-facts.md#data-sources) |
| Git commits (`git:commits`) | Git | Commit, once per project | Yes | [History](../git-client/history.md#git-commits-data-source) |
| Workflow runs (`workflows:runs`) | Workflows | Run, child runs included | Yes | [Workflows](../workflows.md#workflow-runs-source) |
| GitHub pull requests (`github:pull-requests`) | GitHub | Pull request | Yes | [GitHub](../github-integration.md) |
| GitHub issues (`github:issues`) | GitHub | Issue | Yes | [GitHub](../github-integration.md) |
| GitHub Actions jobs (`github:actions-jobs`) | GitHub | Actions job | No | [GitHub](../github-integration.md) |
| Local branches with pull requests (`github:local-branches`) | GitHub | Local branch | No | [GitHub](../github-integration.md) |
| Linear issues (`linear:issues`) | Linear | Issue | No | [Integrations](../integrations.md) |
| Rollbar error groups (`rollbar:error-groups`) | Rollbar | Error group | No | [Rollbar](../integrations/rollbar.md) |

GitLab and Bitbucket serve merge requests, pull requests, CI jobs, pipeline steps, and branches the
same way the GitHub plugin does.

Sources that read Acorn's own database push a time window into SQL and read newest first, so the
host's 5,000-record budget drops the oldest records. Git commits push the window into `git log`.
Sources that call a provider page through its API and report `incomplete` when the provider or the
budget stops them.
