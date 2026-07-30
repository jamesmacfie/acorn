# Claude Code executable-profile migration

Status: **Normative**<br>
Coordinate: `acorn/profile-claude`<br>
Requirement prefix: `CUR-CLAUDE`

## 1. Current behavior and authoritative state

V1 profile ID `claude-code` declares executable `claude`, interactive PTY/tmux launch, Acorn MCP
registration, headless structured execution, resume, a tool-free decision mode and line-delimited
JSON normalization. Headless uses `-p --output-format stream-json --verbose --permission-mode
dontAsk`, optional model and inline JSON schema; resume uses provider session ID. Tool-free mode
adds `--tools ''`. The external Claude CLI owns provider session semantics/output; Acorn owns
Terminal/workflow/agent records and normalized captures.

Agents separately owns a managed Claude driver. That is not this interactive/headless profile.

- **CUR-CLAUDE-001:** The profile and managed driver MUST remain separately installed, versioned
  and permissioned. Either may operate when the other is disabled if its own dependencies hold.
- **CUR-CLAUDE-002:** Installing this profile MUST NOT install, update or execute the Claude CLI.

## 2. Current UI, routes, events, contributions, and dependencies

The profile appears in Terminal’s profile picker and is consumed by Workflow headless steps,
decision generation, session resume and MCP setup. Terminal/Agents panels render normalized events,
results, structured output, provider session ID, cost and token usage. Unknown/malformed lines are
not successful results; exit zero without result/structured output is `malformed`.

There are no profile-specific routes or settings. Application composition imports its descriptor.
Core directly owns argument templates, process execution timeout (ten minutes by default), stream
capture and process-group cancellation.

## 3. Target V2 classification and trust/runtime tier

- **CUR-CLAUDE-003:** Claude Code is an **Acorn Verified executable-profile example**, included in
  the default installation profile. It consists of a declarative profile and a WASI stream adapter;
  the referenced CLI is external user-installed code.
- **CUR-CLAUDE-004:** CLI execution uses Terminal/Workflows/Agents execution policy and is
  intentional code execution. The verified profile artifacts themselves receive no unsandboxed
  native lifecycle hook.

## 4. Node, Electron, native-host, and renderer split

Node core resolves executable/worktree, constructs a secret-minimized environment, launches/kills
the process tree, materializes scoped capabilities and enforces deadline/output caps. Terminal owns
interactive sessions; Workflows/Agents own headless operation state. The profile owns grammars and
the WASI stream adapter. Electron uses standard terminal, agent transcript, tool-call, approval,
timeline, result and error renderers.

- **CUR-CLAUDE-005:** Arguments are generated from typed fields by a version-compatible grammar;
  callers cannot append flags or a shell fragment. Unsupported CLI versions fail closed.
- **CUR-CLAUDE-006:** The stream adapter receives stdout frames only, has no credential/network/
  filesystem authority and returns the common normalized execution-event schema.

## 5. Manifest, required capabilities, permissions, dependencies, and optional integrations

The manifest declares executable/version probe; interactive, headless, resume and tool-free modes;
task-worktree cwd; PTY/tmux preference; stream-json dialect; supported model/schema/session fields;
controlled environment; and MCP-registration compatibility. It requires Terminal profile/process
capabilities, Workflows headless capability when used there, and task-scoped MCP broker capability.
No raw secret, arbitrary network, arbitrary file or bespoke UI permission is granted.

Terminal is required for interactive mode. Workflows and Agents are optional consumers with
explicit compatibility ranges and delegated grants.

- **CUR-CLAUDE-007:** MCP registration exposes only task/session-scoped tools through short-lived,
  audience-bound capability credentials. The child never inherits the Node internal token or
  provider connection secrets.
- **CUR-CLAUDE-008:** Headless/tool ceilings are the intersection of caller, workflow/profile,
  Agents and Task scopes. Profile flags cannot widen them.

## 6. Queries, commands, exported capabilities, events, and streams

The plugin exports `dev.acorn.agent-profile.interactive.v1`,
`headless-structured.v1`, `resume.v1`, `decision-tool-free.v1` and
`stream-adapter.v1`. Queries return descriptor, availability/version and dialect support. Commands
request interactive launch, headless run, resume and scoped MCP registration; durable operation
ownership remains with the calling system plugin.

- **CUR-CLAUDE-009:** Normalized frames distinguish progress, assistant text, tool request/result,
  approval, usage, provider session, structured result, terminal result and malformed raw-line
  notice. Unknown fields cannot grant authority.
- **CUR-CLAUDE-010:** Events are profile `availability.changed` and
  `compatibility.changed`; Terminal/Agents/Workflows emit operation lifecycle facts. Events/audits
  exclude prompt, response, schema, terminal bytes, MCP credential and raw provider event.
- **CUR-CLAUDE-011:** Interactive bytes use Terminal stream; headless progress uses the owning
  operation’s bounded event stream with backpressure. Cancellation kills the process group,
  suppresses late commit and emits one terminal operation fact.

## 7. UI contributions and renderer requirements

The profile picker preserves Claude Code label, availability and tmux warning. Headless consumers
render standard transcript/timeline, tool/approval, structured-result, cost/usage and failure
states. Resume shows the provider session reference as safe metadata, never as authority.

- **CUR-CLAUDE-012:** A missing terminal renderer gives explicit unsupported interactive mode;
  headless results remain viewable through standard log/result renderers. Mobile can monitor and
  approve only when the owning Agents policy permits it.
- **CUR-CLAUDE-013:** Malformed output, incompatible version and permission denial are distinct
  accessible states with safe diagnostics and no raw JSON dump.

## 8. Storage, migrations, backup, uninstall, and reinstall behavior

The profile owns no domain database. Core stores grants/install; Terminal/Agents/Workflows own
sessions, captures, results and provider resume references under their retention policy.
Availability is ephemeral. Any temporary runtime file is private, execution-scoped and excluded
from backup.

- **CUR-CLAUDE-014:** V2 imports no V1 sessions, captures, profile preferences, tokens or MCP
  registrations.
- **CUR-CLAUDE-015:** Disable/uninstall blocks new profile operations but does not delete owning
  plugin histories or provider sessions. Reinstall reprobes CLI version and reissues no old
  capability credential.

## 9. Setup, settings, health, update, and failure behavior

No credential wizard exists; setup reports CLI discovery/version, tmux and MCP compatibility, with
manual installation guidance only. Settings select allowed models/modes within host policy and
refresh detection. Health distinguishes binary missing/version incompatible, tmux absent, MCP
registration rejected, worktree unavailable, permission denied, malformed output, nonzero exit,
timeout, cancellation and resume rejection.

- **CUR-CLAUDE-016:** Restart reconciliation marks non-durable operations interrupted; durable
  Terminal sessions may reattach. Headless work is never automatically rerun after uncertain exit.
- **CUR-CLAUDE-017:** A profile update changing executable, argument/permission ceiling, stream
  dialect or MCP scope requires compatibility gating and owner-visible reapproval where authority
  expands.

## 10. Security and credential treatment

- **CUR-CLAUDE-018:** Child environment is an allowlist and excludes Acorn secrets. Provider
  credentials used by the external CLI remain external/user-managed unless a separate approved
  credential handoff capability is designed.
- **CUR-CLAUDE-019:** Prompt, output, schema, cost and usage are sensitive operation data, excluded
  from general logs/events/crash reports and application-encrypted where persistently classified.
- **CUR-CLAUDE-020:** Executable evidence/cwd/argv are validated against substitution, traversal
  and option injection. Output is untrusted data; a forged tool event still passes the owning
  system plugin’s authorization and approval gate.
- **CUR-CLAUDE-021:** Audit records who launched which profile/Task/mode, capability grant,
  executable version and result class—not content or credentials.

## 11. Existing coupling that must be removed

Remove application imports/registration, direct core calls to Claude profile grammar, direct MCP
registration helper and assumptions in Agents/Workflows. Replace with manifest discovery,
profile/headless/stream capabilities and the task-scoped MCP broker. Keep generic process, PTY,
worktree, timeout and kill primitives in Node core/system plugins.

## 12. Exact fresh-install visual and behavioral parity scenarios

- **CUR-CLAUDE-022:** Compatible `claude` launches interactively in the Task worktree with tmux
  preference, standard terminal UI and task-scoped Acorn MCP visibility.
- **CUR-CLAUDE-023:** Headless execution preserves optional model/schema, normalized result,
  structured output, session ID, cost/usage, ten-minute default deadline, cancellation and resume.
- **CUR-CLAUDE-024:** Tool-free decision mode passes no built-in/projected tools and cannot regain
  them through caller arguments; malformed exit-zero output remains an error.
- **CUR-CLAUDE-025:** A remote client can monitor/attach to Node-owned operations; removing this
  profile does not disable a separately compatible managed Claude driver.
