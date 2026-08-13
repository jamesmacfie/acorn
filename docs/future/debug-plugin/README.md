# Plugin developer-experience review — the work list

This folder is the output of a plugin-DX review run on 2026-08-13. The question it asked: what do
plugin authors have to know or repeat that the host could own instead? The evidence came from
reading all 17 workspace plugins, the `@acorn/plugin-api` facade, the loader/installer/trust
pipeline, the arch-boundary tests, and the 90 commits that touch `plugins/`.

Each file here is one finding, self-contained: what happens today (with file and line references),
why it matters in plain terms, what should change, and where a developer starts. File and line
references were correct on 2026-08-13; verify them against the tree before relying on them.

One thing the review retired rather than filed: the old "adding a plugin means editing four
composition-root files" complaint is mostly paid down. Rail order became a declared `order` field
in `2dab5d95`, the plugin-named `apps/node/src/wiring/` directory is deleted, and a loaded plugin
registers with one roster line. The friction moved — into failure reporting, the dev loop, testing,
and residual copy-paste. That is what these files cover.

## The list, in suggested order

| # | File | One line | Strength |
| --- | --- | --- | --- |
| 1 | [01-failure-visibility.md](./01-failure-visibility.md) | When a plugin breaks, the UI should say what broke. Today it says the wrong thing or nothing. | Strong — do first |
| 2 | [04-loaded-tier-boilerplate.md](./04-loaded-tier-boilerplate.md) | ~90 lines of identical host mechanics pasted into every loaded plugin. Move behind the facade. | Strong |
| 3 | [02-dev-loop.md](./02-dev-loop.md) | No watch mode, sticky ownership rows, four trust prompts per dev boot. | Strong |
| 4 | [03-testkit.md](./03-testkit.md) | Plugin tests rebuild the host by hand, 159 internal imports deep. Give them a testkit. | Strong |
| 5 | [08-loadability-tests.md](./08-loadability-tests.md) | Two load-order gotchas are enforced by allowlists instead of by actually loading things. | Strong |
| 6 | [05-storage-and-config.md](./05-storage-and-config.md) | Eight plugins hand-roll DB lifecycle the host already owns one tier over. | Worth exploring |
| 7 | [06-golden-lists.md](./06-golden-lists.md) | Four undocumented hand-edited test tables per new compiled plugin. | Worth exploring |
| 8 | [07-facade-evolution.md](./07-facade-evolution.md) | The five-day-old facade exports host internals and a version nothing bumps. Prune now while it's cheap. | Worth exploring |

Why 01 goes first: it has the widest reach (both tiers, every failure stage), the current behavior
actively misleads rather than merely omits, the fix is additive with zero plugin changes, and every
other item on this list is easier to build and verify once failures name themselves.

## Standing decisions these files respect

`docs/extensibility.md § Some decisions that look like gaps` and `docs/third-party/README.md` are
treated as settled. In particular: no `when` expression language, ecosystem work (scaffolds,
authoring guides, discovery) deliberately last, "do not migrate for tidiness", and the long-term
direction of confining compiled plugins rather than unconfining manifests. Where a file below
reopens one of those (03 reopens the deferred testkit), it says so and gives the evidence that
justifies reopening.
