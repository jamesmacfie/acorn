# D-2. Manual desktop builds receive the updater signing key

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is medium and latent. The secret
handoff is confirmed from workflow source. Status is open.

## Evidence and impact

`.github/workflows/ci.yml` runs desktop packaging for version tags and manual dispatches. Both
paths pass the updater signing credential into `.github/workflows/build-desktop.yml`, where
repository build commands run with it in their environment. The reviewed workflow does not
declare a protected environment for that step.

The desktop configuration pins the public key in `apps/desktop/src-tauri/tauri.conf.json`.
The reviewed desktop does not have an active updater. Key exposure would compromise a future
updater that trusts the same key. The risk requires control of a build that can receive the
credential. The review did not inspect repository-side dispatch and secret permissions.

## Fix and verification

Keep ordinary manual builds unsigned. Deliver the release signing credential only through
a protected release job with an approved ref, and make signing consume a previously built
artifact. Verify repository-side rules before relying on them to guard the key.

Check that a branch dispatch receives no release signing credential. Verify that an approved
release still produces an artifact signed by the expected key.
