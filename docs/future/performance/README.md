# Reduce startup work and packaged size

Date: October 9, 2026. Status: approved direction; phase 01 implemented October 9, 2026.
Source baseline: `989b069c389df6143b90ffb9889dfeaae5db6010`.

Use these phases to reduce Acorn's shipped bytes and startup work, explain loading progress, and
report user-visible performance through the telemetry pipeline to Sentry. Read the assigned phase
and recheck its owners against the checkout before implementation.

## Decisions

The programme implements these decisions:

- Require Claude Code on the user's machine. Omit the SDK's bundled Claude executable from Acorn's
  installation. Retain the SDK JavaScript used by the ACP adapter; removing that library requires
  replacing the adapter and is outside this programme.
- Minify production service and loaded-plugin JavaScript. Keep useful error diagnostics and measure
  startup time separately from byte savings.
- Show explicit connection, registration, restoration, and failure states with changing startup
  messages. Keep shell geometry stable while individual features load.
- Load substantial renderer and server implementations on demand. Register identities, required
  capabilities, and recovery obligations before consumers need them.
- Measure the first visible frame, restored usable content, first feature opening, startup graphs,
  and packaged bytes. Export supported records to Sentry through Acorn's collector and sink.

## Phase order

Each phase is an implementation handoff. Update its status and this table when it ships, and move
dated acceptance evidence into Testing. Do not create a branch unless the operator requests one.

| Phase | Result | Depends on | Status |
| --- | --- | --- | --- |
| [01: Measurements](./01-measurements-and-sentry.md) | Defined milestones, artifact inventories, and consent-controlled Sentry records. | None | Implemented |
| [02: Packaging](./02-runtime-packaging.md) | Installed Claude executable used; reviewed runtime files shipped. | 01's inventory format | Planned |
| [03: Minification](./03-production-minification.md) | Smaller production output with a formatting-independent budget check. | 01 | Planned |
| [04: Startup UX](./04-startup-and-loading-ux.md) | Meaningful startup messages, recovery, local loading placeholders, and an optional early rail. | 01 | Planned |
| [05: Renderer loading](./05-selective-renderer-loading.md) | Smaller eager graph and less mandatory work behind the first frame. | 01, 04 | Planned |
| [06: Server loading](./06-selective-server-loading.md) | Promise-cached lazy routes and measured optional handler cuts. | 01, 03 | Planned |
| [07: Acceptance](./07-acceptance-and-budgets.md) | Before-and-after evidence, useful budgets, installed-host checks, and live Sentry verification. | 01 to 06 | Planned |

Capture the local baseline at the start of phase 01. Packaging and minification can proceed after
the inventory contract exists; they need not wait for live Sentry access. Phase 04 establishes the
loading states that phase 05 uses. Phase 06 can proceed independently of renderer changes.

## Dated starting evidence

The October 8, 2026 analysis used temporary production builds and inspected staged resources.
The checkout changed during analysis. These figures are leads for remeasurement, not acceptance
targets or a release inventory. The release bundle on disk was dated August 23 and was excluded.

| Measurement | Observed bytes | Qualification |
| --- | ---: | --- |
| Desktop startup scripts | 799,206 | Fresh build; ceiling 775,000. |
| Desktop startup styles | 121,779 | Fresh build; ceiling 200,000. |
| Compiled client roster | 213,795 | Incremental static closure after initial scripts; still required before shell display. |
| Node startup graph | 3,184,482 | Fresh build near the end of the review; ceiling 3,181,000. |
| Terminal startup graph | 722,866 | Staged build; ceiling 723,000. |
| Minified Node startup graph | 1,697,866 | Temporary Oxc build on an earlier snapshot whose unminified graph was 3,179,449. No boot-time claim. |
| Staged desktop resources | 327,900,061 | Includes build metadata; excludes the separate Node executable and Rust shell. |
| SDK Claude executable | 227,251,472 | macOS arm64 staging. |
| Separate Node executable | 122,129,232 | macOS arm64 staging. |

Startup graph bytes, installed bytes, and compressed installer bytes answer different questions.
Keep them separate. A dynamic import changes startup work but still ships its code in the installer.
The 500 KB Vite chunk warning is also distinct from Acorn's failing startup budgets.

## Owners and limits

[Architecture](../../architecture-overview.md) keeps data, agents, workflows, Git, and files on the
Node. The Rust shell owns windows and native presentation. Preserve standalone Nodes, remote Nodes,
the terminal client, plugin trust, persisted layouts, and schema validation.

Use small feature-owned modules, explicit operations, and one owner for mutable startup state.
Entrypoints compose the work; they do not acquire a second plugin lifecycle or telemetry collector.

Broad Rust migration, replacement of Sharp, automatic agent downloads, plugin repository extraction,
and changing compiled plugins into loaded plugins are excluded. Revisit a native implementation only
with a measured bottleneck or a demonstrated dependency saving. Node remains necessary for plugins
and standalone operation after any small native extraction.

## Related designs

[Lazy plugin code](../lazy-plugin-code.md) supplies the `lazyFetch` design implemented in phase 06.
[Compiled tier assessment](../compiled-tier.md), [Node release packaging](../bundle.md), and
[repository extraction](../split.md) retain their separate scope.

The earlier `docs/future/performance/` programme was deleted on September 3, 2026; its plans and
measurements remain in Git history. This folder is a separate programme dated October 9, 2026.

## Combined verification

Run `pnpm lint`, each changed package and consumer suite, `pnpm --filter @acorn/arch-tests test`,
and `pnpm test`. Build and verify the packaged desktop on matching supported-platform runners.
Phase 07 defines real-host and Sentry evidence; unit tests alone do not complete acceptance.
