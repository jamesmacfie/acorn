# Documentation overhaul

Date: October 3, 2026. Status: proposed, nothing started.

The shipped docs under `docs/` run to 33,739 lines across 82 files. 55 of those files are longer
than 220 lines, and the longest, [testing.md](../../testing.md), is 1,508. Many pages mix shipped
behavior with dated measurements and design history. Source comments cite the docs about 3,000
times, so a careless move breaks references that no test checks.

This programme brings every shipped doc back in line with the code, restyles it to one house style,
and splits long pages into topic folders. Six phases do the work in order. Each phase is sized so
one developer can finish it, get it reviewed, and merge it without waiting on the others.

## Scope

In scope:

- Every Markdown file under `docs/`, except `docs/future/`.
- The root `README.md`.

Out of scope:

- `docs/future/`. It holds proposals, so "up to date" means something different there.
- `docs/security/review-2026-10-01.md` and the dated results in `docs/testing/`. They're evidence.
  Rewriting them would change what they record. Fix broken links in them and nothing else.
- `AGENTS.md`. It was rewritten on October 3, 2026, as the short agent guide, and `CLAUDE.md` was
  deleted in its favor.
- `plans/`. It was deleted on October 3, 2026, and remains in Git history.

## The phases

Do phase 1 first. Phases 2 to 6 can run in any order after it, but the order below puts the pages
people read first at the front, and the most-cited pages after the guardrails exist.

| Phase | File | Docs | Lines |
| --- | --- | --- | --- |
| 1 | [Guardrails and the citation check](./01-guardrails.md) | Tooling, plus 14 missing doc paths | Small |
| 2 | [Entry points](./02-entry-points.md) | 8 | 3,224 |
| 3 | [Node, data, and security](./03-node-data-security.md) | 13 | 5,740 |
| 4 | [Renderer, shell, and terminal client](./04-renderer-shell-tui.md) | 14 | 8,896 |
| 5 | [Product features](./05-features.md) | 16 | 7,396 |
| 6 | [Plugin docs](./06-plugins.md) | 22 | 7,495 |

Line counts come from `wc -l` on October 3, 2026, and leave out the evidence files. The testing
check-lists in `docs/testing/` belong to phase 2 for links only.

## How to work a doc

Every phase follows the same steps for each doc it owns:

1. **Check it against the code.** Open every path, route, command, type, setting, and default the
   doc names, and confirm it. Fix what's wrong. Delete what no longer exists. If a claim needs a
   running app to confirm, run it with `pnpm dev:agent` or say in the review which claims you didn't
   check.
2. **Separate shipped behavior from history.** A reference page describes what the code does today.
   Move design reasoning that still matters into a short "Why" section. Label dated measurements
   with their date. Drop narrative about how the code got here; Git history keeps it.
3. **Restyle it.** Follow [the house style](./style.md).
4. **Split it if it runs past about 200 lines.** Follow [the split rules](./style.md#split-a-long-page).
5. **Update every citation.** When a section moves, update the `docs/x.md § Heading` citations in
   source comments and the links in other docs. Phase 1's check finds them.
6. **Run the checks.** Run `pnpm --filter @acorn/arch-tests test` and `pnpm lint`. Both must pass.

Keep one owning page per contract. If two docs explain the same thing, keep it in the owner and link
to it from the other.

## Review

Review each phase as one pull request, or one per doc for the large pages. The reviewer checks:

- A sample of the corrected claims, against source.
- That no shipped behavior disappeared without a reason in the pull request description.
- That every new page is listed in [docs/README.md](../../README.md).
- That the page reads aloud like a person wrote it.

## Done means

- Every in-scope doc is 200 lines or shorter, or the review agreed on a reason to keep it longer.
- `pnpm --filter @acorn/arch-tests test` checks source citations as well as doc links, and passes.
- No in-scope doc names a path, route, or command that doesn't exist.
- Every shipped doc follows the house style.

## Verify before you start

- Re-run the line counts. Other work lands in `docs/` every day.
- Re-run the citation numbers in [phase 1](./01-guardrails.md) once its check exists.
- Read [docs/README.md § Documentation ownership](../../README.md#documentation-ownership). Its rules
  still apply, and this programme follows them.
