# Frontend

The acorn client is a SolidJS single-page app under `apps/web/src/client/`. It is served as static assets by the Hono Worker and talks to the same origin over cookie-authenticated `fetch`. State lives in [TanStack Query](./caching.md) (server data) and SolidJS signals (transient UI). There is no client-side store beyond those two.

## Entry point

`index.tsx` mounts the app:

- Constructs a single `QueryClient` (`refetchOnWindowFocus: true`, `gcTime: 24h`) wrapped in `PersistQueryClientProvider`, persisting the cache to IndexedDB via `idb-keyval` under key `acorn-cache` (see [caching](./caching.md) and [offline/PWA](./offline-pwa.md)).
- A global `QueryCache`/`MutationCache` `onError` bounces to `/auth/login` when an error message matches `/\b401\b|reauth|unauthenticated/`.
- Registers `/sw.js` on `load`, and wipes the persisted cache on the `acorn:logout` window event.
- Mounts `<Router root={App}>` with three routes whose components are all `noop` — routes exist only to populate `useParams()`; `App` renders the actual UI.

## Layout

`App.tsx` is the router root: a top bar plus three independently-scrolling panes in a CSS grid (`grid-template-rows: var(--topbar-h) 1fr`). See [ui-design](./ui-design.md) for tokens and spacing.

```
┌──────────────────────────────────────────────────────────┐
│ topbar:  [«] RepoPicker      owner / repo / #n      ◑ Acct │
├───────────────┬────────────────────┬───────────────────────┤
│ Reviews       │ Navigator          │ Diff                  │
│ (PullList)    │ (PullDetail)       │ (DiffView)            │
│ left          │ mid                │ right                 │
└───────────────┴────────────────────┴───────────────────────┘
```

Top bar (`.topbar`, a `1fr auto 1fr` grid):

- **Left cluster** — a collapse toggle (`«` / `»`) and the `RepoPicker`. Collapse state is local signal `collapsed`, seeded from and persisted to the `left_collapsed` pref; collapsing zeroes the left grid column and hides `.pane-left`.
- **Center** — a breadcrumb (`owner / repo / #number`) or the `acorn` brand when no repo is routed.
- **Right cluster** — a theme toggle (`◑`) and either a `Login` link or the `AccountMenu`.

The three panes each carry a sticky `.section-header` ("Reviews", "Navigator", "Diff") and render `PullList`, `PullDetail`, and `DiffView` respectively. `Shortcuts` is mounted once at the end (no visible markup until an overlay opens).

### Theme

`App` applies `prefs.data.theme` to `document.documentElement.dataset.theme` (falling back to `prefers-color-scheme`). `toggleTheme` flips `light`/`dark`, writes the `theme` pref, and invalidates `['prefs']`.

## Routing

A single dynamic route shape drives everything; the panes read `useParams()` directly rather than receiving props.

| Route | Params | Effect |
| --- | --- | --- |
| `/` | — | Shows brand; `App` redirects to the first repo once `repos` loads. |
| `/:owner/:repo` | `owner`, `repo` | `PullList` loads that repo's PRs; detail/diff show "Select a PR." |
| `/:owner/:repo/:number` | `+ number` | `PullDetail` and `DiffView` load the PR. |

The selected file within a PR is **not** in the path — it is the `?file=` search param (see [diff-rendering](./diff-rendering.md)).

## Component map

| Component | Pane / role |
| --- | --- |
| `App` | Layout root, top bar, theme, collapse, redirect-to-first-repo, logout/permissions. |
| `PullList` | Left pane. Open/Closed tabs, client-side text filter, virtualized PR rows. |
| `PullDetail` | Mid pane. PR header, description, labels, files, checks, conversation, write actions. |
| `DiffView` | Right pane. The diff subsystem — see [diff-rendering](./diff-rendering.md). |
| `RepoPicker` | Top bar. Searchable repo popover with pin-to-top and refresh. |
| `AccountMenu` | Top bar. Signed-in dropdown: Permissions, Logout. |
| `Shortcuts` | Global keyboard handler + help / file-finder overlays. |
| `UserAvatar` | GitHub avatar `<img>` (`sm` 18px / `md` 24px) with a dashed placeholder when login is absent. |

Feature-owned helpers sit next to the views that use them:

- `features/diff/model.ts` parses patches, attaches word diffs, builds renderable rows, and derives split-mode bands.
- `features/diff/DiffRows.tsx` renders non-code rows, code lines, split cells, line composers, and review-thread rows.
- `features/pullDetail/model.ts` merges reviews, issue comments, commits, and review threads into conversation entries and extracts file-thread snippets.
- `features/pullDetail/Conversation.tsx` renders the conversation cards used by `PullDetail`.

### PullList

Reads the shared `repos` cache and gates the `pulls` query on `repoKnown()` — the repo must be in the server's list before requesting its PRs, avoiding a 404 race on a cold URL. `tab` (`'open' | 'closed'`) and `filter` are signals, reset on repo change. The visible list is a `createMemo` filtering by `#number`, title, and author. Rows are virtualized with `@tanstack/solid-virtual` (`estimateSize: 36`, `overscan: 12`) in `.pr-list-scroll`. Each row is an `<A>` link to `/:owner/:repo/:number`. `PullList` owns the `j` / `k` next/prev-PR shortcut via its own `window` keydown listener (ignored while a form field is focused).

### PullDetail

Gates its `pull` + `files` queries on the routed PR number. Builds a single time-sorted `conversationEntries` memo via `features/pullDetail/model.ts`, merging reviews, issue comments, commits, and review threads (`{ kind: 'review' | 'comment' | 'commit' | 'thread' }`). Renders:

- Header: `#number`, title, state badge, author chip, `base ← head` branch flow, file/±line summary, relative age.
- Action bar (state-dependent): merge-method `<select>` + **Merge** / **Close** / **Convert to draft**, or **Reopen** when closed.
- Collapsible `<details>` sections: **Description** (sanitized `bodyHTML` via `innerHTML`), **Labels** (full-row assigned labels + repo-label picker), **Files** (per-file viewed checkbox, status letter, ± stats; clicking sets `?file=` and dispatches a scroll request), **Checks** (status dots + **Rerun** on failed runs), **Comments/Commits** (comment composer + mixed timeline; file threads render a context snippet parsed from the file patch).

`refresh()` invalidates `['pull', owner, repo]` and `['pulls', owner, repo]` after any mutation, since state changes drop a PR from the open list.

### RepoPicker

Replaces a native `<select>`. A button shows the current `owner/name`; clicking opens a popover (`open` signal) with a filter input and a scrollable list. Pinned repos (`★`) float to the top via a stable partition (the server already returns recent-push order); the pin button calls `setPin` and invalidates `['pins']`. A refresh button POSTs `/api/repos/refresh` and invalidates `['repos']` (401 redirects to login). `Escape` and outside pointer-down close it.

### AccountMenu

Signed-in dropdown. Button shows the avatar + chevron; the popover (`role="menu"`) lists the login, **Permissions** (re-runs the OAuth scope grant), and **Logout**. Closes on `Escape` / outside click.

### Shortcuts

Mounted once in `App`; owns a single `window` keydown listener and the help + file-finder overlays. `j` / `k` are deliberately left to `PullList`. All shortcuts except `Esc` are ignored while focus is in an `<input>`/`<textarea>`/`<select>`. The finder ranks files by substring match, then looser subsequence match; `ArrowUp`/`ArrowDown`/`Enter` navigate its results. Finder state is reset per PR.

## TanStack Query

Query option factories live in `queries.ts` so the dropdown and list share one definition. Route builders, response types, and query-key factories live in `../shared/api.ts`; `queries.ts` imports them and keeps the runtime path as plain same-origin cookie `fetch`. A 401 on `/api/me` is the valid logged-out state (returns `null`), elsewhere it throws.

| Factory | Query key | Endpoint |
| --- | --- | --- |
| `meOptions()` | `['me']` | `GET /api/me` |
| `reposOptions(enabled)` | `['repos']` | `GET /api/repos` |
| `pullsOptions(o,r,state,enabled)` | `['pulls', o, r, state]` | `GET /api/repos/:o/:r/pulls?state=` |
| `pullDetailOptions(o,r,n,enabled)` | `['pull', o, r, n]` | `GET /api/repos/:o/:r/pulls/:n` |
| `filesOptions(o,r,n,enabled)` | `['files', o, r, n]` | `GET /api/repos/:o/:r/pulls/:n/files` |
| `pinsOptions(enabled)` | `['pins']` | `GET /api/pins` |
| `prefsOptions(enabled)` | `['prefs']` | `GET /api/prefs` |

`enabled` gates dependent queries (most are gated on `repoKnown()` / a routed PR number). Query-key shapes match the invalidation calls below and are characterized in `apps/web/src/shared/api.test.ts`; keep them in sync. See [caching](./caching.md) for SWR and persistence behaviour.

### Mutations

`mutations.ts` exposes write helpers and uses the same shared route builders as `queries.ts`. Reads are GET; writes are same-origin POST/PUT/DELETE (the Worker checks the `Origin` header for CSRF). A non-OK response throws the structured `error` code from the body so callers can branch (e.g. `merge_failed`, `reauth`).

| Helper | Verb / endpoint |
| --- | --- |
| `mergePr(o,r,n,method)` | `POST …/merge` |
| `closePr` / `reopenPr` | `POST …/close`, `…/reopen` |
| `setDraft(…, draft)` | `POST …/draft` |
| `addComment(…, body)` | `POST …/comments` |
| `addLabel` / `removeLabel` | `POST` / `DELETE …/labels` |
| `addReviewComment(…, body, path, line, side)` | `POST …/review-comments` |
| `replyReview(…, databaseId, body)` | `POST …/review-comments/:id/replies` |
| `resolveThread(…, threadId, resolved)` | `POST …/threads/:id/resolve` |
| `setViewed(…, path, viewed)` | `POST …/viewed` |
| `rerunFailed(o,r,runId)` | `POST /api/repos/:o/:r/actions/:runId/rerun` |
| `setPin(repoId, pinned)` | `PUT /api/pins` |
| `setPref(key, value)` | `PUT /api/prefs` |

### Update pattern

Mutations follow a **mutate → invalidate → refetch** pattern rather than client-side optimistic cache writes:

- `PullDetail` wraps each action in `run(p)`, which `.then(refresh)` (invalidate `['pull', …]` + `['pulls', …]`) and `.catch` into an `actionError` signal.
- `DiffView` thread/line-comment mutations call an `invalidate()` of `['pull', …]` on success; this refetches threads without re-tokenizing patches.
- Toggles backed by prefs (`theme`, `left_collapsed`, `diff_view`) update the DOM/signal **immediately** for responsiveness, then `setPref` + invalidate `['prefs']` to persist. This is the closest thing to an optimistic update in the client.

## Local UI state (signals)

Transient state that must not survive reload lives in `createSignal`, never in the query cache:

- `App`: `collapsed`, `touched` (left-pane collapse).
- `PullList`: `tab`, `filter`.
- `PullDetail`: `mergeMethod`, `draftText`, `reviewBody`, `actionError`.
- `RepoPicker`: `open`, `filter`, `refreshing`, `refreshFailed`.
- `Shortcuts`: `overlay`, `filter`, `active`.
- `DiffView`: `parsed`, `scrollEl`, plus per-composer `open`/`body`/`busy`/`err`.

`createMemo` derives filtered/sorted lists; `createEffect` syncs derived state (theme, redirect, scroll). Persistent preferences are the exception — they round-trip through the `prefs` query.

## Keyboard shortcuts

Exact bindings, from `Shortcuts.tsx` (overlay help list) and `PullList.tsx` (`j`/`k`):

| Key | Action | Owner |
| --- | --- | --- |
| `j` | Next PR in the list | `PullList` |
| `k` | Previous PR in the list | `PullList` |
| `[` | Previous changed file (`?file=`, wraps) | `Shortcuts` |
| `]` | Next changed file (`?file=`, wraps) | `Shortcuts` |
| `/` | Open fuzzy file finder for this PR | `Shortcuts` |
| `?` | Toggle the keyboard-shortcut help overlay | `Shortcuts` |
| `Esc` | Close the open overlay (works even from a field) | `Shortcuts` |

Within the finder overlay: `ArrowDown` / `ArrowUp` move the active row, `Enter` opens the highlighted file. All shortcuts except `Esc` are suppressed while a form field is focused.
