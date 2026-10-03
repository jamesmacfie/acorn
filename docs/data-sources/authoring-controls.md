# Data source authoring controls

This page covers the client side of typed data sources: the query cache, the conformance fixture, and
the shared source and query editor that workflow and dashboard authoring use.

## Client cache and conformance

`packages/client-core/src/features/dataSources/queries.ts` builds keys from Node, plugin, source,
connection, workspace, project, resolved parameters, operation digest, and revision. Connection and
plugin change watchers invalidate matching keys while retaining cached values. Each response belongs
to its full request key, so a response from an obsolete request cannot replace another query's cache.

The portable example is `apps/node/test/__fixtures__/typed-source/node.mjs`. Its manifest registers a
connectionless nested source and dynamic discovery. Modes cover malformed, oversized, incomplete,
duplicate, looping, failing, and nonresponsive reads. The Node conformance tests load its manifest
through the actual schema, synthesize registrations through `initPlugins`, and exercise core POST
routes. They separately register the handler as compiled code and compare records. These tests cover
the registration and route boundary, not package installation or worker isolation.

A core task's `worktreeChanged` value is nullable, and stays `null` until the Node has inspected that
worktree.

## Shared authoring controls

`packages/client-core/src/features/dataSources/SourceQueryEditor.tsx` is the host-owned source/query
editor used by workflow and dashboard authoring. It reads the source catalog,
connections, descriptions, dependent options, and saved-query library through core routes. Provider
plugins contribute descriptors and handlers only; they do not ship forms.

The editor keeps connection scope visible, clears dependent choices and filters when an upstream
parameter changes, and renders only declared operators and typed operands. Dynamic option search is
a metadata read. Record reads happen only when the user chooses **Refresh preview**. The previous
preview remains visible after query edits or a failed refresh and is labelled out of date by its
query digest. A request generation prevents an older response from replacing a newer preview.
Preview rows preserve nested data and identify observed fields without assigning them query support.

Saved queries use the same surface. **Edit saved query** writes the core-owned draft with the existing
750 ms compare-and-swap autosave and device recovery copy. A conflict retains both versions and
offers reload or **Customize for this use**; customization detaches an inline copy and does not alter
the saved query. Unpublished and unavailable saved queries remain visible for repair.

`TypedBindingPicker.tsx` is the corresponding typed field-picker API. Consumers pass admitted
workflow inputs, a current item, and predecessor results with structural schemas and optional
examples. The picker searches labels and JSON Pointers, includes whole objects and arrays, orders
compatible fields before explicit conversions and incompatible fields, labels observed and optional
paths, and says **No preview value** when no example exists. It never invents array indices or parses
arbitrary strings into another type. Required destinations can retain a typed fallback.

The compiled UI surface is `@acorn/plugin-api/ui/data-sources`. It is a lazy entrypoint so consumers
that do not author typed data do not load the editor. A feature-owned kit seam maps that same control
tree to DOM or terminal primitives; neither host reimplements editor rules.

`AuthoringConversation` is the shared AI conversation control for query, workflow, and dashboard
drafts. It sends only the selected scope, draft, bounded conversation, and model choice. The Node
executes model-requested source listing, dynamic discovery, description, and option operations through
the same source runtime as the visual editor. Preview records require an explicit checkbox and use
the ordinary preview route with a limit of three records and 16 KiB. Query proposals return through
`SourceQueryEditor`, which resolves the candidate with the normal query validator before applying one
undoable edit.
