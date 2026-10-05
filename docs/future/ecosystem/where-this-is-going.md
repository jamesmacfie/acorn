# Where the plugin system is going

Date: October 4, 2026. Status: direction, not scheduled. Moved from the "Where this is going" section of
[extensibility](../../extensibility.md). Where this page disagrees with
the shipped docs, the shipped docs win.

These are the next steps for the plugin system, roughly in order of how much they matter.

1. **Node-half containment.** A loaded node half runs in a permission-scoped worker realm
   ([the node realm](../../security/plugin-node-realm.md)). The remaining rung is an operating-system
   adversarial and crash boundary. Every table-owning compiled plugin gets its database from the
   host's `ctx.storage` seam, so the host owns the open, migrate, and close lifecycle for both tiers.
2. **The editor plugin's move.** http moved first, with tables. database followed over the host-owned
   document surface, because a Monaco frame couldn't be served: 7.93 MiB against an 8.00 MiB cap with a
   stub UI, and its language-service workers refused by the one-file origin and a CSP with no
   `worker-src`. The editor stays compiled for reasons A and E in
   [first-party plugins](../../first-party-plugins.md). On September 11, 2026, its standalone pane
   bundle measured 1,271,605 raw bytes, under the 8 MiB ceiling, so size is no longer the blocker. What
   remains is the open-document verb its ⌘P needs (`docs/editor.md`).
3. **Carriers with answers.** `agentContexts` has a manifest form and callers. `overlay` is a frame
   target opened by the `openOverlay` verb, and companion overlays exercise it. `persistedState`
   deliberately gets no manifest form, because the frame's `state.get` and `state.set` are the loaded
   tier's store.
4. **Ecosystem, when it's wanted.** The authoring guide and the scaffold shipped once the contract
   stopped moving. Discovery and a written compatibility policy are still ahead, and discovery waits on
   package signing ([work plan](./work-plan.md)).
5. **The control plane, as a plugin like any other.** A Node can enroll with one at first boot
   ([node enrollment](../../node-enrollment.md)), and a plugin can contribute a Node provider
   ([Node providers](../../plugins/node-providers.md)). Both seams are inert unless configured. The
   reference provider, `plugins/nodes-file`, is a loaded plugin whose manifest grants only its
   configured inventory file, so the seam has a consumer before it has a business behind it.
6. **Web and mobile,** analyzed in [remote](../remote.md). The sandbox is standard web platform, and
   the client's platform access sits behind one adapter, but the hard parts are authentication and
   reachability, not plugins.
