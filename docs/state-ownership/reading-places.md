# Reading places

This page covers where the client keeps a reader's position in a list, a timeline, or a diff, and the
measurements and parsed rows that go with it. Read it before you store a scroll position or cache
something a pane draws. It's part of [state ownership](../state-ownership.md).

The rule for all of them: hold a reading place outside the thing that draws it, key it by identity
rather than position, and clear it where you clear everything else about that entity.

## Lists

Two module-level signals answer for the keyboard, and both are session-only on purpose.

`packages/client-core/src/kit/keys/collectionState.ts` holds `active`, `selected`, and `offset` for every
collection node, keyed by the collection's id and each item's key, never its index. A list rebuilt from
a fresh answer is a new array of new objects, and an index into it points at whatever moved into that
slot. Keying by the item's key is what makes a refetch keep your place.

`packages/client-core/src/host/keys/focusRegions.ts` holds which region of which pane has focus. It's
the one place `focusedPane` is written and the one place `runtime:focus-changed` is emitted. Where you
are in a list is a reading posture, not a preference, so neither is persisted
([focus and typing](../command-palette-and-shortcuts/focus-and-typing.md#focus-and-typing)).

## Timelines

A followed `Timeline` keeps the reader's place as the turn they were on, `ReadingPlace` in
`packages/client-core/src/kit/lib/timeline/readingPlace.ts`. The timeline doesn't hold it:
`plugins/agents/src/client/sessions/readingPlaceStore.ts` does, keyed by the view, and cleared when the
Node drops the session and on a Node switch. A pixel offset would mean nothing once the content above it
changed height, which a live transcript does all the time, and a map inside a kit component can't be
scoped, cleared, or seen.

## Diffs

`DiffReadingPlace` in `packages/client-core/src/features/diff/diffLayout.ts` is the item the viewport
starts in, a file header, a segment by path and ordinal, or a slice of revealed context, and a point in
that item's code rows, or a thread or line block and an offset into it. `diff/viewState.ts` holds it per
scope for the session, with the horizontal offset, the projection, and the file signature it was taken
against, and evicts a task's entries when the task is archived.

A place is restored only in the projection and file set it was taken in, and a place whose item has gone
lands on that file's header. A new revision of the same files keeps the place by its item key, so an
agent saving a file under the reader leaves them at the same segment and depth.

The heights measured for the diff's threads and line blocks belong to the mounted pane. They're held per
projection, keyed by block id, with the fingerprint of the state they were measured in and the width
bucket they were measured at, and a height is reused only while the fingerprint matches. A new file
signature clears every height, and so does leaving the pane. None of it is persisted, because a height
is a fact about one window's fonts and width.

The diff's parsed rows belong to the Node. `packages/client-core/src/features/diff/segmentCache.ts`
holds them in memory beside that Node's query client, so a pane mounted again on the same Node draws
them without a request. One partition per Node, cleared when the Node is dropped, and never persisted.
It holds no reader state, so a thread resolving changes a height and never a cached row
([resident segments](../diff-rendering/loading.md#resident-segments)).
