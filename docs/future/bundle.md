# Finish Node release packaging

Date: October 8, 2026. Status: standalone staging implemented; release delivery and terminal embedding remain proposed.

Use this plan to turn the standalone Node archive into platform downloads and add the terminal client
to desktop installations. [Node distribution](../node-distribution.md) owns the artifact and operator commands.

On October 18, 2026, [Run a Node for clients on other machines](./node-tray/README.md) took over three
sections of this page: platform archives, Windows operation support, and the installer. Follow its
phases for that work. This page keeps the container image, terminal embedding, and macOS signing.

## Starting point

`scripts/pack-node.mjs` stages the Node, migrations, CLI, TUI, and shared `apps/cli/bin/acorn.mjs`
launcher. It checks runtime imports, carries dependency security overrides, and generates an npm
lockfile. Operators install dependencies with `npm ci`; the archive does not bundle a Node runtime.

`apps/desktop/scripts/stage.mjs` stages the headless CLI and the desktop's pinned Node runtime.
It does not stage the TUI. The desktop has an installed command path; extending that path must preserve
headless commands. Read [CLI](../cli.md) before changing dispatch.

SQLite uses the runtime's `node:sqlite`. `node-pty` is the native dependency to package.
Certificate generation runs inside Node and does not require an OpenSSL executable.
Do not repeat the completed staging, dependency scanner, or certificate work.

## Build the container image

[Cloud phase one](./cloud/01-node-image.md) owns the image, local pairing, hosted deployment,
measurements, and image publication. Implement that phase once and update this page when it ships.
A container build can compile `node-pty` without waiting for downloadable Linux prebuilds.

Preserve these container decisions:

- Use a Debian-compatible base and the repository's runtime policy. An Alpine build needs separate
  native-module support and is outside the initial release.
- Choose and document task tooling and pinned agent CLIs. Repositories and data need persistent volumes.
- Publish the listening port without remapping it, because the Node's Host guard compares the port.
- Make a host Docker socket an explicit opt-in. Document its authority and the unavailable behavior
  without it.
- Decide whether the image carries the TUI before publication. Cloud phase one must record this choice.

## Produce platform archives

`.github/workflows/build-node.yml` builds and smoke-tests the five archives on `v*` tags and manual
dispatches ([archives](../node-distribution.md#archives)). Publishing them waits on the same signing gate
as the desktop's installers ([sign macOS artifacts](#sign-macos-artifacts)).

## Finish Windows operation support

Windows has no `SIGUSR1`. Add an operator-controlled way to reopen pairing without stopping active
agents or terminal sessions. Reuse the pairing owner and its authorization rules; do not expose an
unauthenticated remote trigger.

Document and verify access control lists for the Node data root and client token directory.
POSIX `0600` and `0700` modes do not establish the same access restrictions on Windows.
[Node distribution](../node-distribution.md#operations) owns the operator instructions.

Acceptance: reopen pairing on a running Windows Node, pair another client, and confirm that a
running task continues. Record how the installer establishes and checks directory access.

## Add the installer

Each archive carries `install.sh` or `install.ps1`, which installs it for one user, registers it with
launchd, systemd, or a scheduled task through `acorn node service install`, upgrades in place, and
removes it ([install a Node from an archive](../node-distribution/install.md)). The installers act on an
extracted archive. Downloading and checking the checksum stay with the person, as the archive's README
describes.

## Embed the terminal client in the desktop

Extend `apps/desktop/scripts/stage.mjs` and `apps/desktop/src-tauri/tauri.conf.json` to include the
built TUI and shared command dispatch. Reuse the desktop's runtime and command installation flow.
Keep Node resources and client chunks at the paths their launchers resolve.

Acceptance: an installed desktop's command runs headless subcommands and opens the TUI with no
subcommand. Test attaching to a desktop-supervised Node and starting a Node when the desktop is
closed. Verify commands from a directory outside the checkout and after an app upgrade.

## Sign macOS artifacts

Apple Developer ID signing and notarization gate public macOS downloads.
[Shell signing](../shell/packaging.md#signing-gates-and-the-updater) owns the desktop release gate.
The updater signature and plugin-package attestation are separate contracts.

Sign the bundled executables and native modules, notarize the distributable artifacts, and verify
an installation with quarantine applied. Check the configured signing credentials before treating
membership or setup as an external blocker.

## Verify and hand off

Run lint, changed package suites, architecture checks, and artifact-specific smoke tests.
Do not infer an unpacked archive's dependency completeness from workspace tests.
Record runner, architecture, runtime, artifact checksum, pairing result, and shutdown result.
Update [Node distribution](../node-distribution.md) with tested installation commands.

The container can ship independently. Archive installation follows runtime and native packaging;
Windows delivery follows its operation checks. Public macOS delivery follows signing and notarization.
Desktop TUI embedding can proceed separately from standalone release publication.

## Verify before building

- Inspect the packer, desktop staging, command installation, runtime pin, and generated dependency policy.
- Check supported platform triples and native-module loading on matching runners.
- Recheck the pairing API and Windows token storage before adding an operator command.
- Keep relay work in [remote access](./remote-access/README.md) and [cloud](./cloud/README.md).
