# Harden the trust boundaries

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.

This programme turns the findings of a security pass over the core codebase and the plugin seam into
five product requirement documents (PRDs). Each one names a boundary where a control is weaker than
the code around it claims, states the fix, and lists how to prove it. Give one PRD to the developer
who takes that boundary.

The review that produced these ran against the October 1, 2026 baseline recorded in
[the dated review](../../security/review-2026-10-01.md) and focused on what changed since. None of
these findings is an open door today. Each is a control that rests on an implicit property rather
than on the mechanism the comments credit, so each is one ordinary change away from mattering.

## Product goal

Every trust boundary enforces itself through a mechanism a reader can point to, not through a
coincidence of platform behaviour. A desktop command checks its caller. The plugin network and
filesystem limits survive hostile plugin code. A node that leaves loopback does not widen what a
leaked token can do. When a control is defence in depth rather than the primary guard, the code says
so instead of claiming more.

The reviewed scope is the Tauri desktop shell, the Node service and its transport, and the loaded
plugin seam. The threat actors are a malicious or compromised third-party plugin, prompt-injected
agent code holding a task token, and a local process on the owner's machine. Acorn stays single-owner
software, so none of this adds multi-user roles. It closes the gap between what a boundary claims and
what it enforces.

## Execute the phases

These PRDs are independent. Implement them in the recommended order below, or take them in any order
as owners free up. Phases 02 and 03 both touch the loaded plugin realm and share the runtime decision,
so read them together. Complete each phase's acceptance before calling it done. Do not create a branch
or delegate without the user's request.

| Phase | PRD | Outcome | Relationship |
| --- | --- | --- | --- |
| 01 | [Gate desktop commands by caller](./01-desktop-command-authorization.md) | Acorn's own Tauri commands require the main webview or check their caller, so plugin and preview origins cannot reach them. | None |
| 02 | [Make the plugin realm policy tamper-resistant](./02-plugin-realm-intrinsics.md) | The network and builtin allowlists survive a plugin that rewrites shared intrinsics. | Pairs with 03 |
| 03 | [Give the plugin limits an operating-system backstop](./03-runtime-network-and-fs-backstop.md) | The bundled runtime enforces the network and filesystem grants below the JavaScript layer. | Pairs with 02 |
| 04 | [Confine and time-bound internal tokens](./04-internal-token-confinement.md) | A node on the network refuses internal tokens from remote peers, and a leaked token expires. | None |
| 05 | [Fence the automation driver out of releases](./05-automation-driver-release-fence.md) | The WebDriver automation server cannot ship in a release build, and refuses cross-origin callers if it runs. | None |

[Scope boundaries](./refused.md) records what this programme leaves out and why, including the parts
of the plugin threat model that need operating-system sandboxing rather than a code change.

## Ownership and invariants

Trace each boundary from the caller through the gate to the asset it protects. Use these owners:

- `apps/desktop/src-tauri/` owns the shell: the Tauri commands, the webview and scheme handlers, the
  capability files, and the vendored automation driver.
- `packages/node-core/src/server/plugins/` owns the loaded plugin worker realm, its launch grants,
  and the network and builtin policies.
- `packages/protocol/src/plugin/nodeBuiltins.ts` owns the builtin-family policy shared by the ESM
  resolver, the scoped require, and `process.getBuiltinModule`.
- `packages/node-core/src/server/auth/` owns the internal token format and its verification.
- `packages/node-core/src/server/transport/` owns the listener and which hosts it answers to.

Three invariants hold across the programme:

- A control the docs present as an allowlist must be enforced where plugin code cannot reach it, or
  the docs must downgrade it to defence in depth and name the real guard.
- A change preserves existing behaviour for the legitimate callers each boundary serves: the main
  renderer, the node's own loopback calls, and the task-scoped agents.
- No phase claims an operating-system isolation property the runtime does not provide. Rung 3 in
  [the plugin security model](../../security/node-plugin-security.md) remains the owner of that.

## Relationship to the shipped security model

The owning documentation is [the security model](../../security.md) and its topic pages. Where a phase
changes a shipped control, it updates the page that owns it in the same change. Phases 02 and 03 refine
controls the [node realm page](../../security/plugin-node-realm.md) already labels as a resource
boundary rather than a hostile-code sandbox, so they tighten what the realm claims rather than
contradict it.
