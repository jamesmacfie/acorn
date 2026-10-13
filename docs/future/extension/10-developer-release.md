# Phase 10: developer release acceptance

Status: checked by an agent from a clean build, October 13, 2026, with the gaps in
[real-browser results](#real-browser-results). The acceptance that needs a person is open, in the
[person checklist](./10-person-checklist.md). [Set up and troubleshoot](../../browser-extension/setup.md)
owns the setup steps.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

Every phase from [native pairing](./01-native-pairing.md) through [site
notifications](./09-site-notifications.md).

## Deliverable

Deliver reproducible Chrome and Firefox development builds with a CLI-installed independent bridge
and recorded end-to-end acceptance.

## Starting point and owners

- `apps/cli/vite.config.ts`, `apps/cli/bin/acorn.mjs`, and `scripts/pack-node.mjs` own standalone
  delivery.
- Read [local development](../../local-development.md), [testing](../../testing.md), and [writing
  docs](../../writing-docs.md).

## Implementation steps

1. Build the extension and CLI from a clean checkout using the supported Node runtime. Inspect
   emitted manifests, packaged scripts, native launcher paths, and stable development identities.

2. Verify host registration, status diagnostics, repair/reinstall after a moved or upgraded
   standalone installation, and uninstall. State how retained browser custody can be removed
   separately.

3. Test clean Chrome unpacked installation and Firefox temporary installation. Install from the
   built bundles and the CLI-registered host, not through `pnpm dev:extension`. The loop's own
   profile and development host would hide installation faults. Document that Firefox
   development loading is not signed persistent distribution. Do not promise browser store approval.

4. Run all release journeys against a local Node and a paired remote Node with the desktop closed.
   Confirm provider authentication remains on Node, and independently pair each browser.

5. Exercise browser restart, native-host restart, sleeping/unreachable Node, revoked pairing,
   changed certificate, and protocol mismatch. Reconcile durable state and preserve drafts; do not
   auto-retrust or replay writes.

6. Verify permissions from clean profiles, site-specific grants and removal, explicit temporary
   capture, incognito exclusion, and OS notification opt-in. Inspect sidebar screenshots at normal
   narrow and wider panel widths.

7. Add user setup/troubleshooting and plugin-author contribution instructions to the owning
   reference documentation. Mark completed phase status with evidence; keep unfinished acceptance
   visible.

## Demo and acceptance

A developer follows the setup instructions on macOS, pairs without the desktop, hands off one item
from each provider, captures an ordinary page, exchanges messages, resolves a request, and receives
a scoped badge.

- Run CLI, custody, protocol, extension, agents, GitHub, Linear, Rollbar, and touched Node-core
  suites plus any direct consumers.
- Run migration generation/checks if project persistence changed, lint, and repo architecture
  checks.
- Record real-browser results for install/uninstall, sidebar gestures, provider anchors, capture
  access, approval races, Node switches, restart recovery, and notification filtering.
- Record privacy checks for browser storage, OS messages, diagnostics, and site content-script
  responses.

## Verify and complete

Expect lint, affected suites, migration checks, and architecture checks to pass. Record browser
versions, installation form, local/remote Node setup, and any limitations alongside acceptance
evidence.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at the documented developer release. Do not add public store submissions, signing
infrastructure, a separate installer, Windows/Linux support, screenshot editing, or new integration
families.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.

## Decisions made while building

The plan was silent or the code disagreed in these places:

- The standalone CLI is the `pnpm pack:node` archive. Its `dist/cli/native-host.js` is the host
  `acorn browser install` registers, so there is no separate bridge package.
- `pnpm pack:node` fails at this commit, because it builds `@acorn/node`, whose service size check is
  over its ceiling. The clean build raised `ceiling` in a throwaway export only. The ceiling stays as it
  was in this branch; see [the Node size budget](#the-node-size-budget).
- A changed certificate showed as "Offline" until something read from the Node. A regenerated
  certificate means a restart, the broker marks the Node offline while it is down, and its retries then
  fail the pinned TLS chain without a new status. The host now probes an offline selected Node on each
  `nodes.list`, which the sidebar sends as it opens, and puts the answer in the reply. A status event
  alone isn't enough: a sidebar that has just opened ignores status until it has the list, and the probe
  can answer first. The probe waits at most two seconds there, not its usual eight, so a sleeping Node
  holds up the list no longer than that.
- The sidebar's project list loaded once. A project another client added, renamed, hid, or removed
  stayed out of it until the panel was reopened. It now reads the list again on the host's `projects`
  event, which already arrived for site associations. Tasks still load when a project is chosen; a live
  task list needs a new host event, so it is a [limit](../../browser-extension/setup.md#limits).
- While the bridge hadn't answered, the Node list said no Node was paired. It now says the paired Nodes
  show once the bridge answers.
- The transcript inherited the two-column layout of the sidebar's list rows, so a reply sat at the far
  edge from its label, and line breaks were lost. It now reads top to bottom and keeps line breaks. The
  capture buttons wrap whole in a narrow panel.
- Setup and troubleshooting are one topic page, `docs/browser-extension/setup.md`. The sidebar's state
  table moved there from the landing page, which was at its length limit.
- A Chrome started with `--user-data-dir` reads registrations only inside that folder, so a clean-profile
  check registers with `--registry-dir`. Everyday Chrome reads the user-level registration, which only a
  person's profile can show.

## The Node size budget

Measured October 13, 2026, with `node scripts/check-service-budget.mjs` after `vite build` in clean
exports, on Node 26.8.1:

| Tree | Service graph | Over the 1,766,500-byte ceiling by |
| --- | --- | --- |
| Base `3364687d2` | 1,770,883 bytes in 133 chunks | 4,383 bytes |
| This commit's parent `79fb26334` | 1,775,996 bytes in 134 chunks | 9,496 bytes |

The programme added 5,113 bytes and one chunk. `measure:service-graph` puts it in four new modules,
`plugin/handoffs.ts` and `projects/siteAssociations.ts` in `@acorn/protocol`, and
`pluginHost/browserHandoffs.ts` and `routes/browserHandoffs.ts` in node-core, plus growth in manifest
validation, project config, and the agents store and routes. Each is read at boot: manifest validation
checks every plugin's handoffs, and project config checks site associations. None can move behind a
lazy import without making manifest validation lazy.

Local `main` raised the ceiling to 1,775,500 bytes for its own work, and its graph already measured
1,778,176 bytes. Merging this branch adds the 5,113 bytes again. Settle it once, on `main` after the
merge: measure the merged graph, set the ceiling to that figure plus about 2 KB, and name both causes
in the commit message, as the script asks. Until then, the desktop suite doesn't run under `pnpm test`,
and `pnpm pack:node` stops.

## Real-browser results

October 13, 2026, with Chrome 155.0.8059.40 and Firefox 151.0.3 on macOS. Every check ran on a clean
export of `79fb26334` with this phase's fixes, built with Node 26.8.1 and pnpm 11.0.0. The CLI came from
the packed archive, installed under `/tmp` with `npm ci --omit=dev` and the prune step. Nothing ran
through `pnpm dev:extension`.

Chrome ran on a fresh profile, with the host registered by the archive's
`acorn browser install --browser chrome --registry-dir`, and the built bundle loaded by CDP's
`Extensions.loadUnpacked`. Firefox ran on a fresh profile started with `open -na`, with the user-level
registration from `acorn browser install`, and the bundle installed as a temporary add-on by WebDriver
BiDi. Two standalone Nodes ran from the archive: one on loopback, and one advertised on this Mac's
network address, `192.168.1.8`, reached at that address. The desktop app stayed open, because it hosts
the agent session, and nothing contacted it. "Another client" was each Node's launcher credential,
calling its HTTP routes. Turns ran on Codex.

| Check | Result |
| --- | --- |
| Clean install and build of both bundles; manifests, pinned Chrome key, Firefox ID, private windows refused, installed host name | Passed |
| Bundles hold no `eval`, `new Function`, or dynamic import; `content.js` imports nothing | Passed |
| `acorn browser status` before install, `install` for both browsers, `status` after | Passed |
| Registrations allow only the Acorn extension; launchers name the runtime and host entry by absolute path; folders 0700, launchers 0700, custody files 0600 | Passed |
| Installed launcher: both browsers' callers answered, another extension refused with exit 3, malformed frame skipped, bad request answered, oversized header closes | Passed |
| Clean profiles hold no site access and no notifications permission | Passed in both; empty storage and no content scripts checked in Chrome |
| Pair: words match the Node's banner, real code pairs | Passed in both, each browser separately; a bad code refused in Chrome |
| Pair the advertised Node by its network address, switch Nodes both ways, each keeps its own view | Passed in Chrome; Firefox paired it and talked to it |
| A project another client adds appears in an open sidebar | Failed, fixed, passed |
| Conversation: new Codex chat, send, reply, generated title | Passed in both |
| Capture through the toolbar action: link, selection, screenshot; one turn; the agent read the screenshot | Passed in Chrome |
| Site association added in the sidebar; a real Codex question; badge `1` on the associated page; answered in the panel; the Node's list empties and the badge clears | Passed in Chrome |
| Firefox site grant and notification opt-in by pointer input; one OS notification with the generic text; badge `1` | Passed |
| Answered from Chrome while Firefox shows it: Firefox's card turns to Answered with no fields, its badge and notification clear | Passed |
| GitHub pull request #39 on github.com: one button in `PageHeader.Description`; a trusted click opens the card; "Connect GitHub in Acorn…" | Passed in Chrome |
| Native host killed: a new host starts by itself, Online, draft kept | Passed in Chrome |
| Node frozen: Offline after about 40 s with sending off and the draft kept; Online within 5 s of resuming | Passed in Chrome |
| Device revoked from another client: Revoked within 5 s; forget and pair again | Passed in Chrome |
| Node restarted with a new certificate: Offline, then Identity changed on opening the sidebar; the new words shown; forget and pair again | Failed (stayed Offline), fixed, passed on the final build |
| Node frozen, sidebar opened: the list shows within about 2 s, Offline | Passed in Chrome, on the final build |
| Upgrade: a second archive installed beside the first; `install` from it repairs both registrations; pairings kept | Passed |
| Moved install: `status` names the missing entry; the sidebar says the bridge stopped; `install` from the new place and **Retry** recover | Passed; the empty-list wording was fixed |
| Extension removed and loaded again: pairings kept in the bridge, selection reset | Passed in Chrome |
| Browser restart: storage and selection kept; the background starts the host with no sidebar open | Passed in both, with the extension loaded again (see gaps). Chrome restored the draft and conversation; Firefox kept its site grant and opt-in |
| Extension reload: the host starts by itself, no stall | Passed in Firefox |
| Privacy: storage holds IDs, drafts, and plugin declarations only; no token or certificate in either profile, browser log, or Node log | Passed in both |
| Firefox **Remove** drops the site grant | Passed |
| Sidebar at 360 (Chrome's panel), 300, 320, and 640 pixels | Transcript layout failed, fixed, passed; capture buttons wrap |
| `acorn browser uninstall`: registrations and launchers removed, retained pairings named, the sidebar says to install the bridge; bridge folders deleted by hand | Passed |

The run found one defect outside this programme. A JSON request with a chunked body, with no
`content-length`, to `POST /v1/p/agents/sessions/:id/turns` answers 500 `internal`, logged as
`ERR_INVALID_STATE`. The same body with a length answers 200. The bridge always sends a length, so the
extension isn't affected.

These gaps remain. Each is a row of the [person checklist](./10-person-checklist.md):

- Chrome's permission prompt, so Chrome's site grant, its removal, and Chrome's OS notifications.
- A click on an OS notification, and whether it may open the panel.
- Opening the panel from the toolbar by a person in both browsers, and Firefox's toolbar capture.
- Real GitHub, Linear, and Rollbar resolutions and task creation. The Nodes had no provider connections,
  and copying a person's credentials into a test Node is out of bounds.
- A real permission request, the approval race between two clients, an answer during a dropped
  connection, and an answer across a Node switch, from phase 08.
- A Node on another computer. The advertised Node ran on this Mac.
- The desktop closed. It hosts the agent session.
- An extension a person loaded staying installed across a Chrome restart. One loaded through CDP leaves
  when Chrome quits.
- Firefox through `pnpm dev:extension`, from a person's terminal. The agent sandbox still denies
  web-ext's read of Firefox's `profiles.ini`.

Firefox's first native port stalled twice in this run, on a clean install and after a Firefox restart.
Both times Firefox started no host process at all, and the next port started one at once. After an
extension reload in a running Firefox it didn't stall. That fits the first host launch in a new Firefox
process being lost inside Firefox, but the cause isn't proven. The deadline, the restore's retry, and
**Retry** recover from it.
