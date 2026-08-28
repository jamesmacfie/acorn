# Sandboxing and enterprise lockdown

Design notes for constraining what an agent can reach when it runs inside a task. Nothing here is
scheduled. This records the analysis so a future project starts from conclusions instead of
re-deriving them, in the manner of [docs/future/events/](../events/README.md) and
[docs/future/ecosystem/](../ecosystem/README.md).

Two questions started this folder, and they turn out to be different problems with different answers.

1. **Can a rogue agent be stopped from reaching things it should not?** A task terminal is a real
   shell with the whole user account behind it. An OS sandbox fixes the ambient authority the shell
   inherits. It does not fix the authority acorn hands the agent deliberately over the loopback API,
   and that authority has gaps today. See [threat-model.md](./threat-model.md) and
   [api-gates.md](./api-gates.md).
2. **Can a task be locked down for an enterprise, opt-in?** acorn is not a client that a company
   wraps in someone else's sandbox. acorn is the harness. So the product is acorn as the control
   plane: the thing that scopes execution, egress, tools, and audit for the agents it launches. See
   [enterprise-policy.md](./enterprise-policy.md).

## The framing that matters

Most enterprise-agent products scope policy to a user, a device, or a session. acorn scopes to a
**task**, which already carries a project, a worktree, a branch, and a stated purpose. "This task may
reach `registry.npmjs.org` and `github.com` and nothing else" is a sentence acorn can say and a
generic gateway cannot. That is the differentiator, and every design choice here protects it.

The second framing: acorn is further along than an outside inventory would suggest. Six of the nine
controls a high-assurance deployment asks for already have a home in the tree, because the process
broker and the filesystem confinement policy were built at single seams. The
[research](./research.md) file records where each one lands.

## What must not regress

acorn is good because it is fast, local, and the developer owns it. Enterprise policy pulls toward a
governed platform. Those pull against each other, and the resolution is a rule, not a hope: **with no
managed policy present, the policy resolver never runs.** Absent, not defaulting-to-permissive. A
solo developer who never opts in pays nothing and cannot be slowed by a bug in a layer they never
turned on. Every file in this folder holds to that.

## The order

A wall you can walk around is worse than no wall, because you will trust it. So the cheap API gates
that a sandbox cannot fix come first, then the sandbox, then the governance layer.

1. Close the loopback-API gaps ([api-gates.md](./api-gates.md)). **Done, 2026-08-28.** They came
   first because they re-lock controls a sandbox leaves open.
2. Per-task OS isolation ([sandbox.md](./sandbox.md)). The biggest single reduction in host reach,
   and it delivers default-deny egress nearly free.
3. Managed policy and audit export ([enterprise-policy.md](./enterprise-policy.md)). The layer a
   buyer evaluates.

[phases.md](./phases.md) is the consolidated pickup guide: ordered phases with acceptance criteria,
for an agent or developer to work through.

## Files

- [threat-model.md](./threat-model.md) — what an agent in a task reaches today, ambient authority
  against deliberate authority, and the child-env hygiene that is already right.
- [api-gates.md](./api-gates.md) — the confirmed loopback-API holes, each with file and line, the
  fix, and why it is safe. The cheapest and most urgent work.
- [sandbox.md](./sandbox.md) — the per-task OS isolation design: the three execution chokepoints,
  direct-mount, what breaks, what survives untouched, and the two backends.
- [enterprise-policy.md](./enterprise-policy.md) — the managed configuration tier, most-restrictive
  merge, the absent-means-off resolver, audit export, and the plugin containment rung that comes due.
- [research.md](./research.md) — Docker Sandboxes findings, the where-controls-bite map, and what
  acorn already has, with sources.
- [phases.md](./phases.md) — the implementation phases, consolidated and ordered.
