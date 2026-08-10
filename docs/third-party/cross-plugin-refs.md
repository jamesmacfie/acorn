# Cross-plugin references — carrier brief (not started)

**The problem.** github's PR surfaces are enriched by linear through the one sanctioned compiled-tier
seam: `@acorn/plugin-linear/contract`. That import is impossible the day either side is a loaded
plugin, and github is expected to become one. Whatever replaces it must be advertised through the
host, to *all* plugins, because the relationship is symmetric — a linear surface should be able to
show github chips by exactly the mechanism github shows linear ones.

What actually crosses today is three capabilities, and naming them separately matters because they
need three different answers:

1. **Extraction** — `scanLinearRefs(texts)` scans PR bodies and comments for `linear.app/…/issue/…`
   URLs and returns identifiers. Note: URL-shaped, not bare `ENG-42` — the regex requires the host.
2. **Enrichment** — `linearIssuesOptions(identifiers)` batch-resolves identifiers to `{ title,
   state }` against linear's own route, for the chips beside a PR.
3. **Bare-id linkification** — github's own `linkifyLinearIds(root, prefixes)` wraps bare `CRA-404`
   text in anchors. github owns the code, but the *prefixes* are learned from linear refs already
   confirmed in context, which is the disambiguation that makes bare matching safe at all.

## Principles the design inherits

- **No raw regexes in manifests.** The `contentLinks` grammar is exact-arity precisely so no manifest
  string can backtrack the renderer; a plugin-supplied regex reopens that door (ReDoS, catastrophic
  backtracking) and buys a review burden every manifest. Patterns stay a bounded grammar the HOST
  compiles.
- **The URL advertisement already exists.** A `contentLinks` entry *is* "here are my URL shapes";
  adding a second declaration for the same shapes would give authors two ways to disagree with
  themselves.
- **Data crossing plugins rides a route the host fetches**, parsed against a bounded protocol schema
  with host-stamped provenance — the `agentContexts` precedent, and the posture `docs/security.md`
  asks for (no new callback seams).
- **Opening is a solved problem.** A recognised ref is a `ContentLinkTarget`; the existing ladder
  (reference panel / task pane / browser, preference per surface) already decides what a click does.
  This brief adds recognition and enrichment, not destinations.

## The design, three pieces in delivery order

### 1. A host scanner over the contentLinks already declared (extraction)

client-core compiles every registered content-link pattern — both tiers, since the registry already
holds them provider-stamped — into one scanner:

    scanContentRefs(texts: string[]) → { providerId, kind, item, url }[]

Consumers: github's PR body and list, notes, agent transcripts — any surface that renders text.
Plugins declare **nothing new**; the grammar is bounded, so the compiled matcher is host-owned and
linear-time. github's `scanLinearRefs` import is deleted and replaced by a call that works for every
provider at once, including ones that do not exist yet.

### 2. `contributions.refResolvers` (enrichment)

One manifest row naming a route in the plugin's own namespace:

    "refResolvers": [{ "id": "issues", "kind": "linear.issue", "resolve": "/v2/p/linear/issues" }]

The host POSTs `{ identifiers }` (count-capped) and the route answers rows parsed against a protocol
schema — roughly `{ identifier, label, state?: { name, color, kind }, url? }`, lengths bounded,
list capped, `providerId` stamped by the host and never read from the body. client-core exposes one
query helper keyed on `(providerId, identifiers)` with a host-owned cache policy (five-minute
staleness matches today's behaviour). Linear's existing batch route already implements the
semantics; declaring it is a manifest line. github's `linearIssuesOptions` import is deleted, and
with it the last `@acorn/plugin-linear` dependency.

The response vocabulary should start minimal and stay minimal — a label and a state chip. Every
field added here is a field every provider's answer gets rendered with, which is the descriptor-tier
slope ("grow it until it is a UI framework") this folder has declined twice already.

### 3. Bare-token refs — learned prefixes first, token grammar only if needed

The dangerous piece, deliberately last, in two steps:

- **v1 — no new surface at all.** Generalise github's existing trick into the host scanner: a
  confirmed ref (URL-scanned, or on the task's links) of shape `PREFIX-NUMBER` licenses bare
  `PREFIX-\d+` linkification *in the same surface*, attributed to the same provider. No manifest
  field, no ambiguity (the prefix was witnessed in context), no pattern language (the shape is
  host-owned). This covers the case that exists in production today.
- **v2 — a bounded token grammar, only when a real plugin needs cold-start bare refs.** Something
  like `"textRef": "{prefix:A-Z,2..10}-{num:1..7}"`: host-defined character-class atoms with length
  bounds, anchored on word boundaries, compiled by the host into a linear scanner. Two gates make it
  safe: the provider must have a live connection (no jira patterns matching in a workspace with no
  jira), and candidates are confirmed through the plugin's `refResolvers` route before anything
  linkifies — an unconfirmed candidate stays plain text. Confirmation is also the ambiguity answer:
  `ABC-123` claimed by two providers linkifies only for the one whose resolver knows it, and if both
  do, both are real and the surface can offer both.

### Frames

A frame renders its own document, so host-side scanning does not reach a ticket description inside
linear's iframe. Defer: the SDK could later expose the scanner over the bridge (`ui.scanRefs`), but
no current surface needs it, and the bridge verb should follow a demonstrated need rather than
precede one.

## What stays github's own

Owner/repo → project resolution (its domain), and the choice of which surfaces show chips. The
learned-prefix machinery moves INTO the host with piece 3; the two `contract/` files and the
workspace dependency are deleted when pieces 1–2 land.

## Why not "plugins advertise regexes"

It is the obvious one-field design and it was considered. It fails three ways at once: a
manifest-supplied regex is a denial-of-service surface the exact-arity grammar was built to close; a
regex says nothing about *confirmation*, so two plugins' patterns colliding on the same token has no
answer except load order; and it puts a second pattern language beside the one contentLinks already
teaches. The grammar-plus-resolver shape costs one more manifest row and answers all three.
