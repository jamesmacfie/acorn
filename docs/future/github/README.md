# Give GitLab and Bitbucket the same experience as GitHub

Date: October 16, 2026. Status: proposed. Implementation not started.

This programme lists what stands between acorn and a GitLab or Bitbucket plugin that matches the
GitHub plugin, and the order to fix it in. Read this page before you pick up a phase.

## Starting point

Phases 5 and 6 of the [split programme](../split/README.md) moved repository identity and pull
requests out of core on October 15, 2026. A code host plugin claims hosts, core stamps the plugin's id
on each project whose remote is on one, and a task links change requests that core checks out and
opens the declared pane for. [Code hosts](../../plugins/code-hosts.md) documents the contract, and a
`gitlab-test` fixture in `packages/node-core/src/server/core/tasks.test.ts` proves it with no core
edit.

Everything else the GitHub plugin does sits on seams any plugin can use: provider connections, data
sources, browser handoffs, editor line markers, the git plugin's push actions point, workflow gate
policies, context sections, agent tools, panes, and rail markers. The plugin is about 13,300 lines
outside tests, 6,100 of them client code, in `plugins/github/`.

The sign-in pieces worth keeping stay where they are. The device-flow routes and the client id live in
the GitHub plugin, in `plugins/github/src/server/routes/deviceAuth.ts` and
`plugins/github/src/server/config.ts`. Core holds only the generic connection storage and the device
code screen in `packages/client-core/src/features/integrations/deviceFlow.ts`, which any provider uses.

## What still assumes GitHub

These places stop a second code host from reaching parity:

- Agent context. The core tools `pr_current` and `pr_changed_files` read the context section with id
  `pr`, which GitHub owns, and sections receive only the GitHub-only `pullNumber`.
- Workflow CI. The `checks-green` policy and the CI loop import GitHub's policy id, and trigger sweeps
  wake on GitHub's event only.
- Smaller assumptions in core, the browser extension, onboarding, and other plugins: avatars, the
  `ACORN_REPO` variable, address case, the wizard's connect step, and reads of `project.github`.
- Self-hosted servers. Claimed hosts and browser handoff patterns are fixed in the manifest.
- Forks on a host with no change request ref. Core fetches the source branch from origin, which
  fails for a fork. Bitbucket Cloud has no such ref.
- The review UI. A second plugin would copy the GitHub plugin's lists, detail, diff, and checks views.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-change-request-agent-context.md) | Agent context and task tools ask the task's code host, not GitHub. |
| [2](./02-workflow-ci-by-provider.md) | Workflow CI steps and trigger sweeps ask the task's code host. |
| [3](./03-github-assumptions-outside-the-plugin.md) | The small GitHub assumptions in core, the extension, onboarding, and other plugins go. |
| [4](./04-shared-change-request-ui.md) | Review views move into a shared package as a second code host needs them. |
| [5](./05-gitlab-plugin.md) | A GitLab plugin for gitlab.com. |
| [6](./06-self-hosted-hosts.md) | A code host adds hosts at runtime, for self-hosted GitLab and Bitbucket. |
| [7](./07-fork-checkout.md) | Core checks out a fork's change request from the fork's own URL. |
| [8](./08-bitbucket-plugin.md) | A Bitbucket Cloud plugin. |

## Order and dependencies

Phases 1, 2, and 3 are core and plugin seams with no new code host, so a GitHub regression shows up
before anything else depends on them. Take phase 1 first. It changes what plugins depend on, and
phase 2 reuses its lookup from a task to its code host.

Phases 4 and 5 run together. Phase 4 is a rule for extracting UI while GitLab is built, not a project
of its own. Don't design a shared kit before phase 5 needs one.

Phase 6 needs phase 5, because self-hosted GitLab is the first real user. Phase 7 is independent of
both and must land before phase 8. Bitbucket Cloud reaches parity only after phases 1 to 7.

## Decisions this programme takes

- The agent tool names stay `pr_current`, `pr_changed_files`, `pr_checks`, and `pr_review_comments`.
  Prompts, skills, and workflow files name them, and "pull request" is the term most people use for
  all three hosts. They become core tools that ask the task's code host.
- One connection per code host plugin, as GitHub has. GitLab with two instances, gitlab.com and
  a company server, needs two connections. Phase 6 decides whether that's one plugin with
  `maxConnections` above one or one connection per host.
- Bitbucket Data Center and Server are out of scope. Their API, auth, and refs differ from Bitbucket
  Cloud's, and nobody has asked for them.

## What this programme leaves to others

Removing the GitHub-named fields, such as `Project.github`, `Task.github`, `pullNumber`, and
`byGithub`, waits for the next plugin API major. The checklists are in
[split phase 5](../split/05-repository-identity.md) and [split phase 6](../split/06-change-requests.md).
Phase 3 here only stops reading them where a second host needs something else.
