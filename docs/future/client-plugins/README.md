# Client plugins: delivered design record

The five-phase client-held plugins programme shipped in 2026-09. The owning documents describe
current behavior: [plugins](../../plugins.md), [security](../../security.md),
[state ownership](../../state-ownership.md), [frontend composition](../../frontend.md),
[pane layout](../../panes.md), [appearance](../../ui-design/appearance.md),
[desktop shell](../../shell.md), and [terminal client](../../tui.md).

A device can install a client-only plugin from a GitHub release, npm package, HTTPS URL, or a local
folder when the host has a folder picker. The device holds its cache, trust decisions, and state.
The pane switcher, rail, and topbar are named exclusive slots with core fallback. Style packs are
validated token data. `acorn.json` is a data-only interface to device preferences and plugin install
offers. The plans and documentation migration checklist for these shipped phases are in git history.

The supporting documents remain as the reasoning record. Their old paths and future-tense wording
describe the proposal as it was written; the owning documents above govern the implementation.

| File | Record |
| --- | --- |
| [01-why.md](./01-why.md) | Why a device-held plugin and selected replacement surfaces were proposed. |
| [02-omarchy-survey.md](./02-omarchy-survey.md) | Source-system survey and feature mapping. |
| [03-device-provenance.md](./03-device-provenance.md) | Custody, resolution, trust, and state decisions. |
| [04-replaceable-surfaces.md](./04-replaceable-surfaces.md) | Surface contracts and fallback rationale. |
| [05-appearance-and-icons.md](./05-appearance-and-icons.md) | Appearance rationale and the still-parked icon-pack proposal. |
| [06-user-config.md](./06-user-config.md) | Device-file constraints and rationale. |
| [07-hosts.md](./07-hosts.md) | Host checklist and remaining future-web obligations. |
| [refused.md](./refused.md) | Rejected alternatives and their reasoning. |

Icon packs remain unbuilt. The web client still owes browser-backed custody and host-specific source
availability; [remote.md](../remote.md) owns that work.
