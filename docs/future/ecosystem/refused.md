# What is refused, on the record

Part of [docs/future/ecosystem/](./README.md). The refusals this folder already states inline,
collected so a later session argues with the reasoning instead of with silence. Nothing here is new;
each entry names where it is argued in full. First collected 2026-08-30.

One of this folder's refusals was overturned and is kept as an entry, at the bottom, because how it
was overturned is the useful part.

## No discovery surface before containment

A stranger's plugin found through discovery would make the install prompt the whole security model,
and the node half is disclosed rather than contained. Shipping discovery first would turn an honest,
documented weakness into a liability. This is the reason the work plan is ordered the way it is, and
it stays refused until rung 2 of the containment ladder ships
([blockers.md](./blockers.md) § 1, § 2).

## No plugin auto-update before signing

Packages are hash-pinned and audited, but not signed, and provenance is a recommendation. Every hash
change re-prompts on purpose. Auto-update before signing would silently install bytes nobody
consented to ([blockers.md](./blockers.md) § 2; [work-plan.md](./work-plan.md) § What is deliberately
absent).

## No marketplace curation that implies review

There could be a listing, but not a curated one: anything that implies review by listing is a promise
acorn cannot keep. If discovery ever ships it ships unreviewed and says so
([blockers.md](./blockers.md) § 2).

## No wider frame sandbox

The 8 MiB cap, the no-workers CSP, and `connect-src 'none'` are the boundary, not a blocker. Monaco
proved some surfaces cannot live in a frame; the answer is a host-owned surface with a borrowed,
vendor-neutral contract, designed once per surface class (`docs/editor.md`). Widening the
sandbox instead would buy one surface and cost the trust story
([blockers.md](./blockers.md) § What is deliberately not on this list).

## No thin shell; the fat core is the end state

The thin-shell letter is only worth reopening if two things land at once: rung-3 OS sandboxing of
plugin node halves, and a frame-tier successor that can serve worker-hungry, multi-megabyte surfaces
without widening the trust story. The remote component tree is not that successor — it serves
component-shaped UI, while Monaco, xterm, and the webview stay host-owned or rectangles. Short of
both, roadmap language should say "shell" only in the composability sense
([shell-vision.md](./shell-vision.md) § Revisit conditions).

## No provenance claim on a folder install

A symlinked folder cannot be pinned, so the lockfile records `archiveSha256: null` and empty
`entrypoints`, a test holds that, and the install form says so in its own sentence. Recording digests
for a `{ path }` source later would not be a tidy-up; it would be a claim the source cannot support
([blockers.md](./blockers.md) § 3).

## Not refused, and worth saying

Three things read like refusals and are not. The closed action-verb set and descriptor vocabulary
grow one designed addition at a time rather than never. Plugin-to-plugin interop is covered
host-mediated by capabilities, content links, ref resolvers, and five kinds of cooperative extension
point; only bb-style *uncooperative* extension is refused, and that one is refused permanently
(`docs/plugins.md § There is no uncooperative extension`). Downgrade support, a `when` expression
language, and plugin-supplied regexes are refused in their own owning docs, not here.

## Overturned: the generated manifest schema

This folder used to record "deliberately not built: a JSON Schema for `acorn-plugin.json`", because a
second schema is a second source of truth. That is the right answer for a hand-maintained copy and the
wrong one for a generated file. `packages/plugin-types/acorn-plugin.schema.json` is written out of the
Zod contract by a test that fails when the two disagree, so there is still one source of truth, and an
author now gets completion and inline errors before the file is ever loaded
([README.md](./README.md); `docs/plugins.md § The manifest schema`).

The shape of the reversal is the lesson: the refusal was about duplication, and generating the copy
removed the duplication rather than accepting it. Check the same thing before restating any refusal
here.
