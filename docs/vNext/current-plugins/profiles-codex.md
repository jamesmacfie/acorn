# Codex executable-profile migration

Status: **Normative**<br>
Coordinate: `acorn/profile-codex`<br>
Requirement prefix: `CUR-CODEX`

## 1. Current behavior and authoritative state

V1 profile ID `codex` declares executable `codex`, PTY/tmux interactive launch, Acorn MCP
registration, headless `codex exec --json`, optional `-m`, structured output through
`--output-schema <file>`, `codex resume <sessionRef>` and line-delimited JSON normalization.
Structured schemas are written to a newly created temporary directory before launch. The external
Codex CLI owns its provider session/output; Acorn owns Terminal/workflow/agent operation records.

Agents separately owns the managed Codex driver. The profile is not that driver.

- **CUR-CODEX-001:** Profile and managed driver MUST remain separately installed, versioned and
  permissioned, with only declared optional compatibility.
- **CUR-CODEX-002:** Installing the profile MUST NOT install, update or run the Codex CLI.

## 2. Current UI, routes, events, contributions, and dependencies

The profile appears in Terminal’s picker and is consumed by Workflow/agent headless and resume
paths. Terminal/Agents panels show normalized progress/result/usage. V1 has no profile-specific
route, settings page, database or durable event. Application composition imports the profile;
core directly provides process timeout/cancellation, MCP registration, stream parsing and temporary
schema materialization. The current helper creates schema files but does not own a complete
crash-reconciliation/deletion contract.

## 3. Target V2 classification and trust/runtime tier

- **CUR-CODEX-003:** Codex is an **Acorn Verified executable-profile example**, included in the
  default installation profile. It uses a declarative profile plus sandboxed WASI stream adapter;
  the external executable is user-installed code.
- **CUR-CODEX-004:** CLI execution is explicit Terminal/Workflows/Agents code execution. No
  unsandboxed native code is supplied or run by the plugin installation/lifecycle.

## 4. Node, Electron, native-host, and renderer split

Node core resolves executable/worktree, builds allowlisted environment, supervises process trees,
enforces deadlines/caps, brokers MCP and materializes private temporary files. Terminal owns
interactive sessions; Workflows/Agents own headless state. The profile owns typed mode/argv grammar
and WASI JSON adapter. Electron uses standard terminal, agent transcript, tool/approval, log,
timeline, structured result and error renderers.

- **CUR-CODEX-005:** Arguments are typed and assembled without shell evaluation. Executable and
  CLI dialect are version-probed; incompatible versions fail before launch.
- **CUR-CODEX-006:** The stream adapter receives bounded stdout frames only and has no credential,
  network, filesystem or command authority.

## 5. Manifest, required capabilities, permissions, dependencies, and optional integrations

The manifest declares executable/version evidence; interactive/headless/resume modes; task-worktree
cwd; PTY/tmux; supported model/JSON-schema fields; JSON stream dialect; controlled environment;
private temporary-file and task-scoped MCP requirements. It requires Terminal for interactive,
core process/worktree/temp-file/MCP capabilities and optionally Workflows/Agents as consumers. It
requests no raw secret, generic network, arbitrary file or bespoke UI access.

- **CUR-CODEX-007:** The temporary-file grant permits only core-created execution-scoped files with
  supplied validated content. It is not directory, path-selection or general filesystem authority.
- **CUR-CODEX-008:** MCP credentials are short-lived, task/session/audience bound and never the
  persistent Node internal token.

## 6. Queries, commands, exported capabilities, events, and streams

Exports are `dev.acorn.agent-profile.interactive.v1`,
`headless-structured.v1`, `resume.v1` and `stream-adapter.v1`. Descriptor and availability queries
return compatible modes/version. Commands request interactive launch, headless execution, resume
and task-scoped MCP registration; operation state is owned by Terminal/Workflows/Agents.

- **CUR-CODEX-009:** Normalized frames distinguish progress, assistant output, tool request/result,
  approval, usage, provider session, structured result, terminal result and malformed notice.
  Provider-specific/unknown fields are inert.
- **CUR-CODEX-010:** Profile events are `availability.changed` and `compatibility.changed`.
  Operation lifecycle remains with the owning system plugin. Events/audits exclude prompt,
  response, schema body, terminal bytes, raw JSON and MCP credential.
- **CUR-CODEX-011:** Interactive traffic uses Terminal stream. Headless traffic uses the owning
  operation’s authenticated bounded stream; backpressure may coalesce progress but never terminal
  result/error. Cancellation kills the process group and rejects late commit.

## 7. UI contributions and renderer requirements

The profile picker preserves Codex label, availability and tmux warning. Headless operations use
standard transcript/timeline/tool/approval/structured-result/usage/error renderers. Structured
schema is described by safe type/name metadata, not rendered from the temporary file.

- **CUR-CODEX-012:** Clients without terminal capability show interactive mode unsupported while
  allowing authorized headless monitoring. Mobile never obtains a raw PTY implicitly.
- **CUR-CODEX-013:** Missing binary, version mismatch, schema materialization failure, malformed
  stream, resume rejection and policy denial are distinct accessible states.

## 8. Storage, migrations, backup, uninstall, and reinstall behavior

The profile owns no database. Core stores install/grants; Terminal/Agents/Workflows own durable
session/result/resume state. Availability cache and schema files are ephemeral and excluded from
backup.

- **CUR-CODEX-014:** Schema files are created in a private core directory, restrictive-mode,
  referenced by one execution and deleted after success, error, cancellation or timeout. Startup
  reconciliation deletes abandoned directories only after proving ownership and age.
- **CUR-CODEX-015:** V2 imports no V1 sessions, captures, profile preference, tokens, MCP
  registrations or temporary files.
- **CUR-CODEX-016:** Disable/uninstall blocks new operations but does not delete histories owned by
  other plugins. Reinstall reprobes compatibility and never reuses capability credentials/temp
  paths.

## 9. Setup, settings, health, update, and failure behavior

No credential wizard exists. Setup reports Codex CLI/version, tmux, MCP and temp-file broker
compatibility and offers manual install guidance. Settings allow approved models/modes within host
policy. Health distinguishes missing/incompatible executable, worktree denied, MCP rejection,
schema failure, nonzero exit, malformed output, timeout, cancellation and resume rejection.

- **CUR-CODEX-017:** Headless work is not automatically replayed after unknown completion. Restart
  marks it interrupted unless the owning system can authoritatively reconcile the provider session.
- **CUR-CODEX-018:** Changes to executable, args, stream dialect, temp-file scope or permission
  ceiling are compatibility-gated and reapproved where authority expands.

## 10. Security and credential treatment

- **CUR-CODEX-019:** Child environment is allowlisted and excludes Acorn/provider secrets. Any
  credentials used by the installed Codex CLI remain external/user-managed absent a separately
  approved credential handoff.
- **CUR-CODEX-020:** Schema is bounded, validated JSON with depth/property limits. File path is
  core-generated and passed as one argv value; symlink/path substitution and option injection are
  rejected.
- **CUR-CODEX-021:** Prompt/output/schema/usage are sensitive operation data excluded from general
  logs/events/crashes and encrypted when persistently classified. Output/tool events remain
  untrusted and pass normal authorization/approval.
- **CUR-CODEX-022:** Audit records caller, Node/Task, profile mode, executable evidence, grants,
  temporary-file creation/deletion outcome and result class—not content or secret values.

## 11. Existing coupling that must be removed

Remove application import/registration, core knowledge of Codex argv/dialect, direct MCP helper and
profile-owned use of Node filesystem APIs. Replace with manifest discovery, typed profile/headless/
stream contracts, task-scoped MCP broker and core temporary-file capability. Generic process,
worktree, PTY, timeout and cleanup remain core/system responsibilities.

## 12. Exact fresh-install visual and behavioral parity scenarios

- **CUR-CODEX-023:** Compatible `codex` launches interactively in the Task worktree with tmux
  preference, standard terminal UI and scoped Acorn MCP visibility.
- **CUR-CODEX-024:** Headless `exec --json` preserves optional model, structured output through an
  exact schema file, normalized result/usage, timeout/cancellation and resume behavior.
- **CUR-CODEX-025:** Every exit and simulated Node crash removes/reconciles schema files without
  deleting unrelated temporary data; malformed exit-zero output is an error.
- **CUR-CODEX-026:** Remote Electron monitors/attaches through owning Node contracts; disabling the
  profile does not disable a separately compatible managed Codex driver.
