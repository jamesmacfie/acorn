# What is refused, on the record

Part of [docs/future/sandbox/](./README.md). The refusals this folder already states inline,
collected so a later session argues with the reasoning instead of with silence. Nothing here is new;
each entry names where it is argued in full. First collected 2026-08-30.

## No policy engine, and no policy language

Ten vendors sell one, and a home-grown engine becomes a worse OPA to maintain forever. acorn's
managed layer is three settings — egress goes through this network policy, telemetry goes to this
OTLP endpoint, MCP servers come from this allowed set — and everything else routes to what the
enterprise already bought ([enterprise-policy.md](./enterprise-policy.md) § What acorn does not
build).

## No gateway, no DLP, no PII scanner, no guardrails

Same reason, same sentence: that is a market, not a feature. The differentiator is task-scoped
policy, not a reimplementation of Kong
([enterprise-policy.md](./enterprise-policy.md) § What acorn does not build).

## No egress proxy of acorn's own

The sandbox already enforces network policy. Wire the task's allowed egress into the sandbox's policy
at creation and route to that, rather than standing up a proxy acorn has to keep correct
([sandbox.md](./sandbox.md) § Egress).

## No policy resolver when no managed policy is present

Absent, not defaulting-to-permissive. A solo developer who never opts in pays nothing and cannot be
slowed by a bug in a layer they never turned on. This is a rule, not a preference, and every file in
the folder holds to it ([README.md](./README.md) § What must not regress).

## Nothing in this list routes through the sandbox

The editor, the diff renderer, find-in-files, git operations, dashboards, notes, the task rail, and
every read of the worktree stay outside it. Only processes cross the boundary; files are shared
through the mount. A change that starts requiring any of these to route through the sandbox has lost
the plot ([sandbox.md](./sandbox.md)).

## No claim that the sandbox stops exfiltration

It stops the host-ranging kind, not the working-set kind. An agent working legitimately in a task can
still read and transmit the repository it is working in. Egress policy is most of the answer to the
first half; review discipline is the only answer to the second. Say so plainly to anyone who asks
([threat-model.md](./threat-model.md) § What neither layer fixes).

## No sandbox work before the loopback-API gates

A wall you can walk around is worse than no wall, because you will trust it. The cheap API gates a
sandbox cannot fix come first, then the sandbox, then the governance layer
([README.md](./README.md) § The order).

## No host changes before the agent-profile spike

An `AgentProfileContribution` whose command is `sbx` gets a sandboxed agent with zero host changes.
Live with it for a week first. If the round-trip and the port story hold up, build the
execution-target seam; if they do not, the folder learned something cheaply
([sandbox.md](./sandbox.md) § The spike to do first).
