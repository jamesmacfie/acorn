# Phase 6: distribution, and proving the outside path

Part of [phased-review-steps](./README.md). This phase is pointers and sequence, not new design.
Three existing documents own the work: [split.md](../split.md) (moving the loaded plugins and the
UI kit out, publishing the authoring packages), [bundle.md](../bundle.md) (a node you download and
run), and [ecosystem/](../ecosystem/README.md) (the gates on strangers: containment, signing,
discovery). What this file adds is how those tracks interleave with the review findings and the
cloud direction, and the one acceptance test that proves the whole program.

Why the cloud direction cares: the paid service provisions machines that run acorn nodes, so the
node must be an artifact a provisioner can fetch and boot unattended (bundle.md); and the promise
that the control plane is replaceable is only credible when someone outside the repo has actually
built one against published packages (split.md plus phase 3's types).

## The tracks

### 6.1 Node distribution (owning doc: bundle.md)

Follow bundle.md's own ordering; the sqlite step is already done. The cloud-relevant notes:

1. **The Docker image first.** No snags block it, it exercises the no-TTY path end to end, and it
   is the artifact a cloud provisioner most plausibly boots. Phase 5's enrollment variables
   (`ACORN_ENROLLMENT_TOKEN`, `ACORN_CONTROL_PLANE_URL`) join `ACORN_ADVERTISE_HOST` and
   `ACORN_DATA_DIR` in the image's documented environment once 5.3 lands.
2. The Linux node-pty prebuild in CI (glibc; the musl decision is recorded in bundle.md).
3. The CI matrix and release upload, Linux and Windows first.
4. The Windows snags: replace or bundle `openssl` before anyone downloads a Windows build, and
   decide the `SIGUSR1` and file-mode answers.
5. macOS last, behind the Apple Developer ID.

**The one item waiting cannot shrink:** the Apple Developer Program membership plus notarization
setup. It blocks macOS node downloads and desktop auto-update (two separate standing constraints,
one purchase), and [ecosystem/work-plan.md](../ecosystem/work-plan.md) already recommends buying
it before it is on the critical path.

### 6.2 Publishing the authoring surface and the plugins (owning doc: split.md)

Follow split.md's five-step order: publish `acorn-plugin-sdk` and `create-acorn-plugin` as they
stand (this proves the release pipeline); extract the UI kit inside the repo before splitting it
out; build the publishable `acorn-plugin-api` dist and the protocol package; move linear as the
pilot; fix http's direct node-core imports and move it last.

Phase 3 items slot into this track: the declaration-only types package (3.1) and the generated
manifest schema (3.2) publish alongside the SDK, and the testkit program (3.11) is what makes
out-of-repo plugin test suites possible at all. Split.md's known hazards stand, in particular the
bundled-plugin seeding gap: publishing a new plugin version does nothing on machines holding the
old one until the reconciler learns version bumps.

### 6.3 Signing, containment, discovery (owning docs: ecosystem/blockers.md, docs/security.md)

The ordering rule from the ecosystem folder stands and this phase does not soften it: containment
before discovery, so acorn never has a window where strangers can find plugins whose node halves
run uncontained.

- **Write the signing design doc.** It does not exist, nothing gates starting it, and both plugin
  auto-update and discovery hang off it. Sigstore-style attestation is the named direction. Keep
  the two signing problems separate on paper: plugin-package attestation is not Apple code
  signing, and neither substitutes for the other.
- **Containment rung 2** (one child process per plugin node half, plugin-scoped token, ctx as
  RPC) is the long pole. It is startable today per the work plan, it is
  [sandbox/phases.md](../sandbox/phases.md) phase 5's launch requirement for any enterprise
  story, and the six design rules that keep it a refactor are already enforced. It is also what
  lets the trust prompt for a cloud plugin tell the truth.
- **Discovery** stays hard-gated on rung 2 and stays unreviewed-and-honest when it comes.

### 6.4 The acceptance test: an out-of-tree control plane

Extensibility review, build-out phase 6, and the reason this phase exists in this folder. Write a
second control-plane plugin, out of tree, against a stub server, using only published packages
and the documented enrollment protocol. If it needs a single host change, the seam is not
finished and phases 3 or 5 reopen. Done when that plugin enrolls and lists a node on an
unmodified acorn.

This is also the moment the marketing site's plugin reference
([marketing/README.md](../marketing/README.md)) stops being aspirational: the generated manifest
reference, the schema URL, and the compatibility page all describe surfaces an outsider has now
exercised.

## Acceptance

- `docker run` of the published image boots a node that pairs from a desktop client on the LAN,
  and with the enrollment variables set, appears in the stub control plane's inventory.
- A plugin scaffolded outside the repo builds, type-checks, tests, and installs on a packaged
  acorn using only published packages.
- The signing design doc exists with a recorded decision, and the auto-update refusal either
  stands (documented) or lifts behind it.
- The out-of-tree control-plane plugin passes 6.4 with zero host modifications.

## Verify before building

- Each owning doc carries its own verify-before-building list; use those first. Cross-cutting
  checks: whether rung 2 shipped out of order, whether the folder-install lockfile still refuses
  to pin `{ path }` sources (the honesty argument in `docs/security.md § Installing from a
  folder` must not quietly change), and whether the npm names split.md wants are still available.
- Confirm the Apple Developer Program status before sequencing macOS work; it is the only item
  where waiting does not shrink the cost.
- Check whether phase 5 landed `FleetBridge.adopt` and the enrollment protocol doc; 6.4 is
  meaningless without both.
