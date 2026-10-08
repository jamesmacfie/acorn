# Security diagnostics

Settings > Security and backup has **Check this node** in the agents section. Use it to read evidence
on the selected Node. A project and running managed session are optional. The agents plugin owns the
device-only `GET /v1/p/agents/security-diagnostics` report and `/scopes` choice routes. Task and
service tokens cannot read either route.

The report stays in the open page, expires after five minutes, and clears on Node or scope change.
Acorn stores no report history. The terminal client lists the core settings page with its established
desktop fallback, so this action is available in the desktop app on a device paired with the Node.

## Evidence and limits

Each finding contains a stable check ID, owner, Node and scope IDs, checked time, evidence state,
severity, source, bounded explanation, limit, and repair action. Observed, configured only, unknown,
unsupported, and failed are evidence states, separate from severity. A failed read does not establish
that a control is off. The selected session's observed settings take precedence over defaults for the
next session.

The check reads stored agent defaults, the selected session's recorded harness options and tool
ceiling, the last already observed harness capability descriptor, the latest in-memory pre-turn
admission outcome for the selected task or project, managed MCP definitions, core plugin-host counts,
core agent-tool preferences, the verified tool catalog, and fixed project files. It reads at most
32 KiB from each named project file after resolving the project's canonical root. It does not execute
configuration code, package managers, MCP servers,
hooks, harness probes, models, or credential validation. It returns no raw argument, header,
environment entry, credential value, or provider output.

Project policy inspection calls Changes' typed, passive static policy capability when it is
available. It reports npm or pnpm identity and version, policy setting names, numeric release age,
script suppression, build approval and ignore counts, allow-all-builds intent, release-age exception
counts, and registry origins without
credentials. Unknown values remain unknown. The capability reads at most 32 KiB per fixed config file
and 128 KiB total after the selected project's canonical root is resolved. It does not parse lockfile
contents. The capability call shares the diagnostic's timeout and cancellation fence.
If Changes is unavailable, the diagnostic uses its smaller fixed-file summary. Neither path proves
that every install follows those files. Pnpm policy cannot cover npm, npx, Python, or arbitrary scripts.
Revision-specific dependency changes appear in [Changes](../diff-rendering/changes-pane.md#the-file-list).

The plugin host reports counts of active executable grants, enabled development modes, enabled
approved and unapproved skills, and pending changed packages. It does not expose package names or
declarations.
Admission retains at most one recent passed, blocked, or incomplete outcome per task for up to 100 tasks
in this Node process; it has no persistence or report history. No observation remains after a restart.
Current approval status remains unknown because validation would decrypt stored instruction bodies.
An old approved snapshot still does not prove current files match. Harness loop coverage comes only
from an already observed provider descriptor; absent metadata stays unknown. Reported capability reach
does not prove hook registration or enforcement. Global harness configuration remains unknown. A
running session's MCP panel may have more harness-reported state than this passive report. Phase 09 owns managed MCP
installation and review.

The Node owner retains host access. Findings describe evidence, not a security score or a containment
guarantee.
