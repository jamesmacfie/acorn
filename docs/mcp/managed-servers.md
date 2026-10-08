# Managed MCP servers

This page details exact npm installation, device consent, and tool catalogue review. See
[the MCP overview](../mcp.md#your-own-servers) for harness configuration and session behavior.

**Install an MCP package** accepts an exact npm name and version. Acorn plans a private frozen npm
graph with lifecycle scripts disabled, checks each package's registry publication time against a
seven-day cutoff, and records SHA-512 archive integrity, the lock and installed tree digests, the
chosen binary, the Node runtime identity, and the installation policy version. A package with an
install script is refused. An exact version lacking trustworthy publication evidence or younger than
seven days needs an explicit reason, stored with the installation and recorded in the owner audit log.
The staged binary must be tested and its graph and tools reviewed before activation. Updates keep the
selected version if staging fails. The selected script runs directly with Node from private installed
bytes; no package runner resolves it on session start. This pins inputs but does not sandbox runtime
behavior.

Every saved server requires device consent for its exact configuration revision before its first Test
or session launch. The confirmation shows the command or endpoint and credential names without values;
Test executes local code or contacts the server. Editing the server or its secrets requires fresh
consent. Package activation has its own confirmation for the staged graph and binary. Older command
and HTTP rows remain editable but require consent before launch.

**Review tool definition changes** is optional and off for existing servers. When enabled, Acorn
places a session-owned loopback MCP proxy on the actual harness connection. It withholds tools until
the device approves the full canonical catalogue on that connection, including descriptions,
schemas, annotations, and forwarded fields. Approval binds the configuration and secret revision,
managed installation identity when present, catalogue digest, and comparison version. A changed list
or observed drift quarantines calls until a new review; approval rechecks the live upstream list.
Settings shows added, removed, and changed declarations with escaped text and redacted credential
spans. A call already in flight cannot be undone. If the proxy cannot bind or the harness cannot use
its HTTP declaration, the server is unavailable under review. Servers from personal harness config
files remain outside Acorn's proxy.
