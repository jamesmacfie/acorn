# Updating existing plugins, and the data underneath them

Design notes from the bb-comparison session (2026-08-12). This answers the question raised when
the end goal was first discussed: agent-authored plugins are one thing, but *updating* an existing
plugin that owns database tables "sounds hard." The answer, verified against the code: **most of
the hard part already shipped**, and shipped better than bb's equivalent. What remains is a small
residue of genuinely hard cases and a stance to adopt about them.

## What already works (shipped, tested)

The machinery is recorded in full in `current-state.md § Storage and migrations`; the short form:

- A table-owning plugin ships a Drizzle migration chain *inside its package*; the host — not the
  plugin — opens the DB and applies the chain at `storage.open()`.
- On update, the installer replaces the package directory **atomically**, new `migrations/`
  included. The running process keeps executing the old code against the old schema; the roster
  says `pending-restart`; the new chain applies at the next boot's `open()`.
- A broken chain fails **contained** — that plugin ends up `failed`, the node boots, other
  plugins are untouched.
- Uninstall keeps the `.sqlite` unless data purge is explicitly requested, so remove-and-reinstall
  is not data loss.
- There is a downgrade guard at install time, an integration test covering
  update-with-migration against a populated DB, and one production caller (`plugins/http`)
  proving the path end to end.

Compare bb: migrations are an array of SQL strings where the array index is the migration id,
tracked in a plugin-owned table, with the contract "append-only, never reorder or edit shipped
statements" stated in the authoring docs. Cruder mechanism — but that *contract* is the useful
part, and it is what acorn should state explicitly (below). bb's one mechanism worth borrowing
outright is the **pre-activation state snapshot**: before activating a managed update, bb
snapshots the plugin's DB, settings, kv, schedules, and registration row, and rolls the lot back
if activation fails. acorn's contained-failure answer ("the plugin is `failed`, fix forward")
is acceptable for v1; the snapshot is the upgrade if agent-driven updates make failed activations
common.

## The genuinely hard residue

Two cases the shipped machinery does not cover, one interaction the reload design creates:

**Downgrades — old code, newer schema.** Once a migration has widened the schema, running the
previous plugin version against it is undefined behavior at the data layer: reads may work by
luck, writes may violate what the new columns assume. bb does not solve this either (its update
refuses same-version reinstall and checks engine ranges, nothing more). The stance: **do not
support downgrades at all.** The installer's downgrade guard already points this direction. The
honest fallback for a bad update is reinstall-with-purge, or restore the `.sqlite` from whatever
backup discipline the node has — say that in the docs rather than implying a rollback exists.

**Reload × migration** (created by `agent-authored-plugins.md § 2`). Today migrations apply at
init-time `storage.open()` during boot. A live reload re-runs `init`, so a dev-loop iteration
that adds a migration applies it **mid-process**: the old handle must be closed before the new
chain runs, and if the candidate init then *fails*, the schema has still moved — candidate
rollback restores the old registrations but cannot un-migrate. This is acceptable **in dev mode
specifically** (the plugin's author is the agent iterating on it; the data is theirs to break),
and it is one more reason reload stays scoped to dev-mode plugins. Write the invariant down for
the implementer: registration rollback and schema rollback are different promises, and only the
first is made.

**Identity is forever.** The plugin id is the SQLite filename, so a table-owning plugin's id can
never change across any update, ever. The manifest id regex (no dots) is part of what makes the
layout collision-free. Any future "rename a plugin" feature is actually "new plugin + data
migration + tombstone" and should be costed as such.

## The stance, in five lines

1. Agents may update plugins **they authored** (dev-mode installs); updating store-distributed
   plugins stays a human decision through the same approval flow as install.
2. Schema changes are **append-only**: never edit or reorder a shipped migration. State this as a
   rule in the authoring skill (bb's contract), enforce it with acorn's existing mechanism
   (Drizzle chain validation — a reordered chain already fails the journal check).
3. **No downgrade support.** Reinstall-with-purge is the documented fallback.
4. Reload applies migrations mid-process **in dev mode only**, and schema changes are exempt from
   candidate rollback — written down, not discovered.
5. Plugin ids are permanent.

## Verify before building

Whether migrations still apply inside `storage.open()` at init (the reload interaction assumes
it); whether the downgrade guard still exists in the installer; whether more than one production
plugin owns tables by then (raises the stakes on the snapshot-rollback upgrade); and whether
anything now depends on plugin data surviving an id change (nothing should).
