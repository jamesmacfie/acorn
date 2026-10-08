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
ceiling, approved instruction snapshot metadata, managed MCP definitions, core agent-tool preferences,
the verified tool catalog, and fixed project files. It reads at most 32 KiB from each named project file after resolving the
project's canonical root. It does not execute configuration code, package managers, MCP servers,
hooks, harness probes, models, or credential validation. It returns no raw argument, header,
environment entry, credential value, or provider output.

Project policy inspection recognizes `package.json`, `.npmrc`, and `pnpm-workspace.yaml`. It reports
package-manager identity, declared scripts, Git or URL dependency sources, recognized policy setting
names, exact `ignore-scripts` booleans, and a simple numeric `minimumReleaseAge`. It does not parse
YAML collections or prove that every install follows those files. It cannot apply pnpm policy to npm,
npx, Python, or arbitrary scripts. Detailed dependency parsing belongs to phase 08.

The report marks global harness configuration, plugin executable grants, development mode, skill
approval, pending packages, and any other fact without a passive owner contract as unknown. It does
not retain each pre-turn instruction outcome or prove that an old approved snapshot still matches.
Harness bridge coverage is a configured description, not proof of enforcement. A running session's
MCP panel may have more harness-reported state than this passive report. Phase 09 owns managed MCP
installation and review.

The Node owner retains host access. Findings describe evidence, not a security score or a containment
guarantee.
