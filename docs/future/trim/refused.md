# Trim: refused and deferred approaches

Date: 2026-10-04. Status: decisions for the planned programme.

## Refused

- **Rewrite the application or change frameworks.** Existing runtime contracts, strict typing, and
  small feature files are assets. The evidence points to specific owners and imports.
- **Remove useful libraries to reach a package-count target.** Editors, highlighting, query caching,
  schemas, crypto, storage, terminals, browser control, ACP, and MCP carry substantial behavior.
  Reimplementing them would move maintenance work into Acorn.
- **Treat the full lockfile as production payload.** Development tools, optional targets, peers, and
  overlapping branches require separate accounting.
- **Omit all optional packages.** Required native executables can be optional platform dependencies.
  Targeted staging must preserve the package graph and its target's required files.
- **Delete Solid patches during trimming.** Their documented Show and Suspense semantics protect UI
  behavior. They are upgrade debt, not demonstrated unused code.
- **Split files mechanically or add a generic controller framework.** File count is a poor proxy for
  comprehension. Extract coherent responsibilities with explicit inputs and one state owner.
- **Remove agent guards as redundant complexity.** Startup reservations, generation checks, durable
  admission, safe retry classification, and joined retirement protect real races.
- **Change API major, database history, or stored identifiers during extraction.** Behavior-preserving
  refactors must retain existing consumers and data. No resets or destructive migrations.
- **Move compiled plugins into loaded workers for tidiness.** Tier changes affect permissions and
  process behavior and need a separate product and security justification.
- **Change CI topology or weaken tests to make the programme cheaper.** Focused iteration is already
  available; the complete verification gate remains required.

## Deferred unless new evidence establishes a need

- **Unify CodeMirror and Shiki.** Editable document semantics differ from static fences, logs, and
  diff highlighting. Shiki already uses fine-grained imports. No equivalence proof supports removal.
- **Deduplicate every locked version.** Most repeats reflect platform binaries or incompatible
  constraints. The programme does not upgrade libraries or force incompatible resolutions.
- **Remove Rust/Tauri crates by raw count.** Optional features and platform targets need a dedicated
  emitted-artifact analysis before such a claim is sound.
- **Split every large frame registration or broker module.** These are secondary hotspots. The
  broker is a security boundary; gratuitous fragmentation could obscure its gates. Revisit only with
  a concrete change that benefits from a bounded extraction.
- **Replace the keymap with a custom engine or maintain a vendor fork.** Phase 05 first seeks a
  supported narrow dependency. A fork or replacement needs a separate plan for parity and upkeep.
- **Migrate GitHub data without a consumer.** Phase 14 records current strain and a concrete adoption
  decision. A schema/protocol migration is separate work with explicit compatibility acceptance.

## Verify before building

Compare these reasons with the live code and the evidence record. A changed product requirement can
justify a new plan; raw dependency counts or line counts cannot overturn these decisions alone.
