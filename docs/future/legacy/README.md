# Architecture and legacy reset

Date: 2026-09-21. Status: tickets 01–12 implemented; ticket 13 acceptance recorded with host limits on 2026-09-23.
Evidence baseline: commit `9727fd85`. The original review changed no application code or user state.
Re-checked on 2026-09-22 against `4bdbf29b`. Findings and Memory work landed in that window and
narrowed parts of tickets 03 and 04 without starting either. Paragraphs marked "After the baseline"
in [findings](./findings.md) and [target architecture](./target-architecture.md) say what moved.

At the review baseline, Acorn's runtime topology was worth keeping, but ownership was uneven: some
features used plugin contracts while others reached through shared client code or application
composition. Compatibility survived outside SQLite, and some retired stores still received writes.
A database reset alone could not remove those paths safely. Tickets 01–12 addressed those findings;
[ticket 13](./13-acceptance.md) records the checks and the host gaps that remain.

This programme makes one deliberate breaking transition, then leaves one supported representation
per contract. It preserves extensibility, containment, desktop and terminal support, and the product
behaviour described in the owning documentation.

## Read in this order

1. [Context and coverage](./context.md): constraints, data flows, coverage, and validation evidence.
2. [Findings](./findings.md): concrete problems, their consumers, and their disposition.
3. [Target architecture](./target-architecture.md): ownership and contract decisions.
4. [Reset and versioning](./reset-and-versioning.md): exact reset policy and version-1 transition.
5. [Refused alternatives](./refused.md): what to retain and why.

## Implementation order

The tickets were implemented in order. The dependencies below are minimum prerequisites, not permission
to ship intermediate builds to existing installations. Release acceptance is recorded in ticket 13.
Every ticket links to the shared context; read that before implementing the ticket.

| Ticket | Outcome | Blocked by |
| --- | --- | --- |
| [01: Recoverable reset tooling](./01-reset-tooling.md) | Exact state inventory and a tested, explicit reset operation. | None |
| [02: Remove custody and preference adoption](./02-device-legacy.md) | Device state has one owner and one format. | 01 |
| [03: Canonical review proposals](./03-canonical-proposals.md) | Memory proposals enter Findings directly; no legacy proposal store. | 01 |
| [04: Plugin-owned lifecycle collaboration](./04-lifecycle-ownership.md) | Completion and archive policy leave application composition. | 03 |
| [05: Canonical API representations](./05-canonical-api.md) | One task-context projection, credential shape, and notes route owner. | 01 |
| [06: Plugin-owned workflow and agent contracts](./06-contract-ownership.md) | Shared packages stop carrying plugin domain rows and forms. | 05 |
| [07: Terminal-owned client state](./07-terminal-client.md) | Core stops calling Terminal routes and storing its full session rows. | 06 |
| [08: Explicit plugin contracts](./08-plugin-contracts.md) | One command descriptor form and checked worker/type contracts. | 06, 07 |
| [09: Fresh database baselines](./09-database-baselines.md) | One initial migration per table-owning package. | 03, 04, 05 |
| [10: Version-1 cutover](./10-version-one.md) | Routes, manifests, stored formats, tooling, and clients agree. | 02–09 |
| [11: Close library exports](./11-library-exports.md) | Package entry points enforce the intended boundaries. | 06–10 |
| [12: Naming and focused simplification](./12-maintainability.md) | Names and module responsibilities match the final architecture. | 04, 08, 11 |
| [13: Acceptance and documentation](./13-acceptance.md) | Fresh-install, plugin, host, and reset evidence recorded. | 01–12 |

The first priority is to replace live legacy producers, then delete their compatibility graph.
Boundary changes come next. Renumbering and migration consolidation finish the breaking transition.
Avoid mixing unrelated visual redesign or feature additions into these tickets.

## Verify before building

- Confirm the baseline commit and recheck cited consumers; line numbers are dated navigation hints.
- Read the owning reference docs as well as this programme. This programme retains the original
  decisions and dated source evidence; the reference docs own current behaviour.
- Run the acceptance checks in each ticket and record results, including failures and unrun checks.
- Never run a reset against this checkout's enclosing data root without an explicit target inventory.
