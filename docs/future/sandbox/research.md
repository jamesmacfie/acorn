# Research

Part of [docs/future/sandbox/](./README.md). What was read, what it means for acorn, and where the
controls a high-assurance deployment asks for already land in the tree. Recorded so the next project
does not re-fetch the same pages.

## Docker Sandboxes (`sbx`)

Source: <https://docs.docker.com/ai/sandboxes/> and the `sbx` CLI reference beneath
<https://docs.docker.com/reference/cli/sbx/>. Read 2026-08-24.

Each sandbox is a microVM with its own kernel, filesystem, network, and Docker daemon, on the host's
native virtualization: macOS `virtualization.framework`, Windows Hyper-V. So it is macOS and Windows
only. A Linux host needs a different backend ([sandbox.md](./sandbox.md) § Execution target).

Command surface that matters here:

- `sbx run <agent>` — launch an agent, attached. `sbx create` — create in the background. `sbx exec` —
  run a command in a sandbox, flags matching `docker exec`. `sbx setup` — detect and prepare the host.
- Workspace mounting has two modes. **Direct** bind-mounts the folder at its absolute host path;
  edits appear on the host immediately. **`--clone`** clones the repo inside the sandbox, isolating
  edits, with the host repo read-only at `/run/sandbox/source`.
- **`--clone` cannot be used from a git worktree other than the main one.** This is the line that
  rules clone mode out for acorn, because every task is a worktree. Direct mount is the only option,
  which is also the one that keeps the editor and diff working.
- Sandboxes persist and reconnect by workspace path or `--name`. Installed packages and images
  survive stop and restart. Removing a sandbox deletes what is inside; workspace files on the host
  remain.
- Network is isolated by default. First run picks a global policy: open, balanced (recommended), or
  locked-down. `--publish 8080:3000` maps a sandbox port to a host port. An interactive dashboard
  monitors outbound connections and manages per-host rules.
- Credentials: `sbx secret set` stores a secret and a host-side proxy injects it, so the value is not
  stored in the sandbox. For Claude Code with a subscription, `/login` inside the sandbox does OAuth
  and **the token stays on the host and is never stored in the sandbox.** That property is the most
  valuable single line on the page for this design.
- Pricing: the `sbx` CLI is free including commercial use; organization governance (central
  filesystem, network, and MCP policy) is a paid subscription.

Implication for acorn: `sbx` is a ready backend for the execution-target seam, direct-mount only,
reattach by task id, egress wired from the task's policy. The organization-governance tier overlaps
with what [enterprise-policy.md](./enterprise-policy.md) proposes acorn owns; acorn's version is
task-scoped, which `sbx`'s is not.

## Where controls bite

From the enterprise deep-research pass. The single most useful idea: a control's strength is decided
by *where it is enforced*, and vendor feature lists blur the classes together.

| Class | Examples | Strength | Stops |
| --- | --- | --- | --- |
| Prompt/instruction | `CLAUDE.md`, `AGENTS.md` | Advisory | Nothing an adversary does; shapes an honest model |
| Runtime tool policy | Claude `permissions.deny`, Codex command rules, MCP allowlists | Stronger | A tool call the runtime refuses |
| OS/runtime isolation | Claude sandbox, Codex sandbox, `sbx`, E2B, Daytona | Strong | What executed code can read, write, reach |
| Tool/API mediation | ToolHive, agentgateway, MCP gateways | Strong | Which tools are discoverable and callable |
| Inference gateway/DLP | Kong, Cloudflare, LiteLLM, Portkey, Bedrock Guardrails, Model Armor | Strong for traffic through it | Data in the model request, model choice |
| Enterprise perimeter | MDM, Purview, Zscaler, endpoint DLP, cloud IAM | Strong but channel-dependent | Devices, identities, browser/SaaS use, egress |

Two lessons acorn should absorb rather than rebuild:

- **A deny rule does not close every egress path.** Anthropic notes its network proxy does not
  inspect TLS by default, and a broad domain allow-list becomes an exfiltration route. OpenAI is
  candid that Codex's local network proxy does not cover web search, connectors, MCP, browser use,
  cloud tasks, or model/auth traffic. So "deny internet" is meaningless until every egress path is
  named. For acorn this is why the HTTP pane must move inside the sandbox
  ([sandbox.md](./sandbox.md) § What breaks) rather than being trusted to obey a task-level rule.
- **Make the model the least-trusted component.** The whole high-assurance pattern is defense in
  depth where instruction files improve behavior and enforceable boundaries carry the security. "Never
  upload credentials" belongs in an instruction file; "this process cannot read credentials or reach
  arbitrary hosts" belongs in the sandbox and the egress policy.

## Native vendor stacks, briefly

- **Claude Code** has the richer documented managed-policy surface: managed JSON with allow/ask/deny,
  filesystem and network sandbox, model and MCP allowlists, managed-only permission and hook locks,
  version enforcement, MDM delivery (Jamf, Intune, Group Policy), and a self-hosted identity-aware
  gateway. Relevant as the reference for what [enterprise-policy.md](./enterprise-policy.md)'s
  vocabulary should cover.
- **Codex** has an open-source CLI, OS-native sandbox with network off by default, isolated cloud
  tasks, centrally managed runtime requirements, and an automatic approval reviewer that fails closed.
  Its documentation's candor about proxy-bypass channels is the source of the egress lesson above.

acorn is neither of these. acorn is the harness, the slot OpenHands Agent Canvas occupies in that
market. So the design copies the *controls* from these stacks and applies them at acorn's own seams,
rather than wrapping either client.

## What acorn already has

Six of the nine controls a high-assurance deployment asks for have a home in the tree today. This is
the payoff from single seams, and it is why this folder is a finishing job rather than a rebuild.

| Control | Where it lives today |
| --- | --- |
| Isolated execution seam | The enumerated `child_process` allowlist, `tools/arch/boundaries.test.ts:217`; the broker, `core/proc.ts` |
| Filesystem confinement | `server/worktrees/pathGuards.ts`, one symlink-aware policy |
| Untrusted-config gate, fail-closed | `server/repoConfigTrust.ts`, hash-gated `needs-trust` / `config-changed` |
| MCP/tool allowlisting, narrow-only | The agent-tool registry ceiling, `docs/agent-tools.md` § Projections |
| Immutable audit trail | The append-only `audit` table, `docs/security.md` § Audit |
| Credential brokering | `SecretService.use`, `core/secrets.ts` — plugin code never holds a decrypted secret |

The three that are not yet in place, and where this folder puts them:

- **Centrally immutable configuration** — [enterprise-policy.md](./enterprise-policy.md) § The one
  rule.
- **Default-deny egress** — [sandbox.md](./sandbox.md) § Egress.
- **Audit export off the box** — [enterprise-policy.md](./enterprise-policy.md) § Audit must leave the
  box.

## Sources

- Docker Sandboxes: <https://docs.docker.com/ai/sandboxes/>
- Docker Sandboxes usage: <https://docs.docker.com/ai/sandboxes/usage/>
- Docker Sandboxes get started: <https://docs.docker.com/ai/sandboxes/get-started/>
- `sbx` CLI reference: <https://docs.docker.com/reference/cli/sbx/>
- The enterprise-lockdown deep-research pass (Claude Code, Codex, gateways, CASB/DLP) was supplied by
  the project owner and is distilled above rather than linked; its vendor claims should be
  re-verified against current vendor documentation before any procurement decision.
