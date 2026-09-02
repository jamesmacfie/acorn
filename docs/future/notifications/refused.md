# Refused

2026-09-02. What this programme decided not to do, with the reasoning, so a later session argues with
the reasoning rather than with silence.

**A notifications table on the node.** A notice is an event the client already saw; the node's
session row is the durable truth and `docs/state-ownership.md` already puts notices on the device.
A node-side log would need a route, a read state per device, retention, and a second answer to
"what needs me" beside the attention projection that already exists. The bell's ring of 50 is the
log. If a remote client needs history, that client reads `agent-session:changed` and keeps its own.

**Computing edges on the node.** Tempting, because the projection is there and every client would
agree. But whether an edge is news depends on whether you were looking, and focus is a fact about
one window. herdr computes on its server and forwards the client's focus state over the wire, which
costs a round trip per keystroke of attention. The reducer is small enough to run in every client.

**One notice per event.** The behaviour being replaced. A `request` is one prompt of possibly many
in a turn; a `turn_completed` is one turn of possibly many in a run. An event is not news, a change
of state is.

**Pinging a clean exit.** `exited` with code 0 means the owner quit the agent. herdr does not ring
for it and neither does anything else in the references. The rail already shows the session is gone.

**Finished pings for workflow sessions.** A workflow turn is a step. The run is the unit the owner
cares about and `run-done` already reports it. Two rows for one fact was finding 3.

**Sounding for blocked while you watch it.** herdr sounds for Blocked on the active tab and only
suppresses Finished. gouda does not, and says why: the sound is for reaching you when you are not
looking at the screen. Acorn's "Needs you" row and the rail's per-task marker already show the block
to someone who is looking. If a reader asks for herdr's asymmetry, it is one more boolean in the
preference, not a change to the model.

**Bundled sound files or a custom sound path.** herdr ships two mp3s and a system-player ladder
with a warning about `aplay`. A synthesised two-note chime through WebAudio has no asset, no player,
and no format question, and it is what gouda and emdash ship. A `sound` field naming a file is the
seam if anyone asks; the settings schema leaves room for it.

**A window-title or tab-title marker.** The dock badge is the desktop's marker and the topbar count
is the terminal client's. A title marker is a third place saying the same number, and OSC 0 fights
the host terminal for a title it may be templating itself.

**A third surface for notifications.** The bell has two sections and the user asked to keep it. A
sidebar status board in herdr's shape would duplicate the rail's per-task markers. The terminal
client gets an overlay because it has no bell at all, not because the desktop needs another.

**Per-agent or per-harness mutes.** herdr mutes `droid` by default. Acorn's per-event toggles cover
the complaint that prompted this programme. A per-session mute is the seam that fits acorn's model
(a `muted` flag on the client's snapshot map) and it is not built until someone asks.

**Claude Code's `Notification` hook as the source of truth.** gouda, verne, emdash, and cmux all
install it. Acorn owns the driver: the ACP and Codex normalisers already emit `request` and
`turn_completed`, and the node projects them. A hook would be a second, less reliable source for a
fact the node has, and herdr's `claude_settings.rs` is the record of what happens when the two
disagree.

**Screen-scraping manifests for managed sessions.** The same reason. For PTY agents the terminal
plugin already screen-scrapes into `AgentState`; this programme reads that field and does not add a
second scraper.

**Changing `AgentAttentionReason` on the node.** The seven values are right and the collapse to five
client states is a projection, not a correction. An `acknowledged` value on the node was considered
for finding 16 and refused: acknowledgement is per device, and the node's field would have to become
per device with it.

**Requesting the system notification permission at boot.** A permission prompt before the user has
seen the app is the fastest way to a permanent deny. The prompt comes from the settings toggle or
the test button, both of which the user pressed.

**Blocking on the terminal client's missing preference store.** Finding 14 is real and larger than
notifications: theme and keybindings are unsettable there too. The terminal client reads an
environment variable for this programme and the store is a door in `docs/tui.md`, not a phase here.
