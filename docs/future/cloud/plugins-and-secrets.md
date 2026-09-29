# Plugins, cloud connections, and secrets

Status: proposed, 2026-09-29. A cloud task runs on a full Node, so it can run plugins. This file
covers which plugins a worker runs, how a team approves them, where their settings and credentials
come from, and how model keys reach an agent.

## Plugin policy

Plugins install and activate per Node today ([plugin activation](../../plugins/activation.md)).
Project policy adds a selection rule on top. It is not a separate install per project and it does
not change the Node-wide lifecycle.

- **Team baseline.** A team admin approves a plugin package by its exact hash, with the Node grants
  its manifest asks for. The baseline applies to every shared project.
- **Project override.** A project can add or disable approved packages and pin a different
  approved version.
- **Frozen lock.** When an attempt is reserved, the team Node computes the effective set and freezes
  it as the plugin lock, with a digest. The client shows it before launch. The worker installs
  exactly that set.

Built-in plugins are always available. The policy can disable a built-in for a project.

### Which packages are eligible

The first release accepts built-ins and hash-pinned GitHub, npm, or tarball installs. A folder
install is a symlink with no stable hash, and a development grant has nothing immutable to verify,
so neither can be approved. An author packages a folder first.

The worker runs the same manifest validation and the same permission-scoped loader as a local Node,
including containment rung 2 ([security](../../security.md)). A missing or incompatible package
blocks launch with its plugin ID and the reason. acorn never silently runs a different set.

### Client trust stays per device

Team approval governs the Node half on hosted Nodes. It does not trust a client bundle on anyone's
machine. Each device still asks its person before running a plugin's client code for a new hash.
Because trust is keyed by plugin ID and hash, one acceptance covers that bundle on the team Node,
every worker, and every restore Node.

### Syncing from a local Node

A member can offer a plugin they run locally for team approval. What moves is the package source
and hash. What does not move: the local Node's integration credentials, plugin database, or
preferences. Never copy a local plugin database into a worker as a way to configure it.

## Cloud connections

A plugin that talks to a provider needs a connection on the Node where it runs. For cloud tasks,
that is a team-owned connection held on the team Node, not a person's local connection.

- An admin creates cloud connections on the team Node: GitHub, Linear, Rollbar, model providers, and
  any loaded plugin's connection kind.
- The team Node sends a worker only the connections its plugin lock needs, in its seed.
- A plugin either works with those settings, or it declares a provisioning step the admin reviews.
- The launch check names every missing connection and setting before spending on a worker.

**Git access.** A worker needs to fetch and push. Recommended: a GitHub App installed on the team's
organization, with the team Node minting a short-lived installation token per attempt, scoped to the
project's repository. A person's OAuth token is the fallback for personal accounts. Which one ships
first is an open question in [phase 5](./phases/05-cloud-task.md#open-questions).

## Team secrets

The team Node stores team secrets encrypted, the same way any Node stores integration credentials
([credential handling](../../security.md#credential-handling)). Admins write them. Nobody reads them
back through the API.

## Model keys

Teams supply model provider keys. This is the sharpest part of the secret story, because the agent
CLIs that acorn drives read their key from the environment, and the sandbox programme's
[child environment policy](../sandbox/threat-model.md#ambient-authority-already-careful-still-wide)
deliberately keeps provider credentials out of every child process.

Three options, from strongest to weakest:

1. **A credential-injecting loopback proxy.** The worker Node runs a small proxy on loopback. The
   agent's `ANTHROPIC_BASE_URL` or equivalent points at it, with a placeholder key. The proxy adds
   the real key from `SecretService.use` and forwards to the provider. The key never enters the
   child. This is the pattern Docker Sandboxes uses for credentials
   ([sandbox research](../sandbox/research.md#docker-sandboxes-sbx)). It works only for harnesses
   that let you change the base URL.
2. **A task-scoped environment variable.** The key is injected into the agent process's environment
   only, not into terminals or setup scripts, and only for the harness that needs it. An agent can
   read and send its own key. That is the trust cost, and it must be written down.
3. **The key in the worker's environment.** Every process can read it. Refused for production.

Recommended: option 1 where the harness supports it, option 2 as the named fallback, decided per
harness in [phase 7](./phases/07-isolation.md). The proxy is a credential broker, not an egress
filter, so it does not conflict with the sandbox programme's refusal to build an egress proxy.

Limit each key's scope where the provider allows it, such as a dedicated workspace key with a spend
limit. Omit unrelated secrets from every worker. Revoke and rotate a leaked key.

## Verify before building

Check which agent harnesses accept a base URL override. Check which plugins read connections at
`init` rather than per request, since a worker receives its connections in the seed and a plugin
that caches them early needs them before `init`. Check the plugin installer's handling of hash
pinning for each source kind in `packages/node-core/src/server/plugins/installer.ts`.
