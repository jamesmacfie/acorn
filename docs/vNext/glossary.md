# Glossary

**Status:** Normative terminology
**Requirement prefix:** `GLOSS`

| Term | Definition |
| --- | --- |
| Acorn Client / Client | A presentation application paired with Nodes. V2 ships Electron. |
| Acorn Node / Node | Electron-free service owning workspaces, execution, durable state, plugins, commands, and events. |
| Artifact | Immutable content-addressed package unit: manifest, Node runtime, client UI, schema, migration, native executable, or asset. |
| Attention item | Node-qualified fact requiring owner action, aggregated in the Fleet shell. |
| Bespoke UI | Signed executable web UI rendered in a separately isolated Electron sandbox and accessed only through the typed bridge. |
| Capability | Versioned authority or service interface exposed by core, Client, Node, or plugin. |
| Client artifact | Plugin UI package independently obtained and verified by Electron. |
| Command | Authorized, validated, idempotency-aware request to perform or begin a mutation. |
| Community plugin | Publisher-signed but Acorn-unreviewed artifact from the community marketplace. |
| Contribution | Manifest-declared extension to a supported Acorn surface such as a pane, command, event, setting, or renderer. |
| Core | Minimal Node and Client platform needed for identity, transport, resources, plugin hosting, semantic UI, storage isolation, and lifecycle. |
| Declarative UI | Validated semantic document rendered by Acorn-owned components; contains no executable code, raw HTML, or arbitrary CSS. |
| Developer Source | Exact Git commit or local source installed through the high-risk developer workflow. |
| Event | Versioned, committed fact published through a durable per-Node sequence. |
| Fleet | The owner’s paired Nodes and the Client-side aggregate projections over them. |
| Full-disk encryption | Operating-system storage encryption relied upon for ordinary databases, blobs, caches, and active worktrees. |
| Marketplace | Signed metadata and artifact distribution channel. Acorn has trusted and community channels. |
| Native plugin | Platform executable hosted as a supervised external process; not an Electron preload or arbitrary main-process module. |
| Node artifact | Plugin logic installed on and executed by a Node. |
| Node descriptor | Description of Node identity, protocol, plugins, renderers, limits, and health obtained over an authenticated Node session. |
| Pairing | Owner-confirmed exchange that verifies Node fingerprint and issues a full-authority Client certificate. |
| Plugin | Versioned package that contributes data, behavior, UI, settings, events, capabilities, or workers to Acorn. |
| Resource | Node-owned entity with canonical URI `acorn://<nodeId>/<type>/<id>`. |
| Renderer capability | Semantic UI implementation bundled with a Client, such as `acorn.code-editor`. |
| Secret reference | Opaque identifier usable only with an authorized credential broker; never the secret plaintext. |
| Stream | Flow-controlled, cancellable sequence for terminal, log, file, binary, or progress data. |
| System plugin | Acorn-signed, release-locked plugin allowed to run in-process and not independently uninstallable. |
| Task | Repository/branch/worktree unit of work belonging to one workspace and Node. |
| Trust tier | Provenance/review classification; separate from runtime sandbox and granted authority. |
| View session | Bounded Node-side session producing semantic UI documents/patches and accepting declared actions. |
| WASI Component | Default sandboxed executable format for Community plugin logic. |
| Workspace | Named group of repositories owned by exactly one Node. |
