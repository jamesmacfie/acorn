---
name: improve-plugin-dx
description: Review an existing plugin system for authoring friction and extension-point opportunities, then present the best candidates as a visual HTML report.
disable-model-invocation: true
---

# Improve Plugin Developer Experience

Find work that plugin authors understand or repeat but the host could own. Recommend changes that deepen extension points: less host knowledge in each plugin, more leverage behind the seam, better locality, and an interface that is natural to author, test, debug, and evolve.

Load `/codebase-design` for the architecture vocabulary: **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**, **extension point**. Use those terms exactly; do not substitute "component", "service", "API", or "boundary".

Use `CONTEXT.md` for domain language. Treat relevant ADRs in `docs/adr/` as existing decisions, not suggestions to rediscover.

## Explore

### Scope from author evidence

If the user named an extension point, lifecycle stage, hook, or authoring pain, start there.

Otherwise, find the surfaces plugin authors actually use: author docs, examples, templates, public exports, registration/configuration paths, test helpers, and real plugin adapters. Trace a small representative plugin and, where available, a more demanding or recently changed one.

Use `git log` and nearby history to identify churn and recurring fixes, but treat history as supporting evidence rather than the definition of scope.

Read relevant `CONTEXT.md` terms and ADRs before judging the design.

Exploration is complete when you can describe how a representative author gets from registering a plugin to testing it, including which host modules, ordering rules, lifecycle rules, and configuration they must understand.

### Walk the author's journey

Walk the codebase as a plugin author, not as a host maintainer. Follow the journey from registration and configuration through execution, composition, debugging, testing, and change over time.

Look for friction along these dimensions:

- **Depth and intent** — does the interface ask for what the author wants to contribute, or expose how the host accomplishes it? Repeated host mechanics in adapters are candidates to move behind the seam.
- **Locality** — can an author understand and change one plugin locally, or must they know unrelated host modules, internal types, hidden invariants, or distant configuration?
- **Lifecycle and composition** — are discovery, registration, multiplicity, ordering, conflicts, cleanup, and failure behavior explicit and predictable when multiple adapters participate?
- **Evolution** — how tightly is an adapter coupled to today's host representation? Can the host evolve without forcing unrelated plugin changes?
- **Testability and diagnosability** — can an author exercise the plugin through the same interface with a lightweight test host or adapter? When it fails, can they tell whether it registered, when it ran, what it received, and which plugin caused the failure?

Also notice:

- boilerplate copied across plugins;
- plugin code reaching past the public interface into host internals;
- state carried awkwardly between lifecycle hooks;
- configuration or registration whose correctness depends on undocumented order;
- broad context objects that make every adapter depend on more host knowledge than it uses;
- tests that reconstruct host internals instead of crossing the plugin seam;
- helpers that hide syntax but leave the underlying extension point shallow.

Record evidence as you go: concrete adapters, repeated code, internal imports, tests, docs, workarounds, and relevant history. Prefer observed friction over theoretical extensibility.

### Test each opportunity

For a suspected shallow extension point, apply the **deletion test**:

- If deleting it makes complexity disappear into the host behind a cleaner seam, the extension point was probably not earning its depth.
- If deleting it makes the same complexity reappear independently across plugin adapters, it is earning its keep.

For a proposed new seam, look for real variation. **One adapter = hypothetical seam, two = real.** Do not generalize one implementation without evidence of a second adapter or concrete second need.

For each surviving candidate, identify three things:

1. what plugin authors currently have to know or repeat;
2. what responsibility should move behind or change at the seam;
3. what the plugin adapter would be responsible for afterwards.

A good candidate reduces author knowledge or repetition without merely moving complexity sideways.

Prefer compatibility-preserving deepening. If the strongest solution conflicts with an ADR or established extension contract, keep it only when the observed friction justifies reopening that decision and mark the conflict explicitly.

Classify confidence:

- **Strong** — repeated evidence across adapters, tests, docs, or history; the seam change removes substantial author friction.
- **Worth exploring** — concrete friction and a plausible deepening, but narrower evidence or meaningful migration trade-offs.
- **Speculative** — based mainly on one adapter or an inferred future need.

Do not invent extension points merely because they would make the diagram prettier.

## Present candidates

Follow `HTML-REPORT.md` for the report scaffold, Tailwind/Mermaid usage, and visual patterns.

Write a fresh report outside the repository:

- use `$TMPDIR` when available, otherwise `/tmp`;
- on Windows use `%TEMP%`;
- name it `plugin-dx-review-<timestamp>.html`.

Open it with the platform default (`xdg-open`, `open`, or `start`) and tell the user the absolute path.

Start with a compact author-journey view showing where friction was observed. Then render one card per candidate.

Each card must contain:

- **Files** — modules and adapters that provide the evidence.
- **Evidence** — the concrete author behavior, repetition, leak, test workaround, or lifecycle trap observed.
- **Author's pain** — what the author must understand or do today.
- **Seam diagnosis** — why the current interface is shallow, leaky, poorly placed, or missing an extension point.
- **Change** — distinguish the host-side responsibility, the seam change, and the resulting plugin-side simplification.
- **Benefits** — explain the gain in **locality**, **leverage**, authoring, testing, and diagnosability.
- **Before / after** — show the author's experience today versus afterwards with code or a diagram.
- **Compatibility** — migration implications and any ADR conflict.
- **Recommendation strength** — `Strong`, `Worth exploring`, or `Speculative`.

The before/after must demonstrate responsibility moving across the seam, not merely fewer lines produced by a helper.

Use schematic pseudocode for the "after" state. Show what the author would no longer need to know, but do not design exact new interfaces, method names, or types yet.

Use Mermaid for lifecycle, registration, ordering, or host↔plugin relationships. Use hand-built HTML/CSS/SVG when the point is author effort, surface area, or boilerplate collapse.

End with **Top recommendation**. Choose the candidate with the best combination of author reach, friction removed, evidence strength, and migration cost. Explain why it should come first.

Do not implement or fully design the new interface yet.

After opening the report, ask:

"Which of these would you like to explore?"
