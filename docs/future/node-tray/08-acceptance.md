# Phase 8: accept it on real machines

Date: October 18, 2026. Status: proposed. Depends on every other phase.

## Goal

Prove the programme's journeys on real hardware, with the Node on one machine and the client on
another, and record the results as a dated page in `docs/testing/`. Every check in earlier phases ran
on one machine or on CI runners. This phase is where a different network, a low-end machine, a
reboot, and a real person's sign-in meet.

## Starting point

- `pnpm dev:remote` runs a Node in a Linux container and pairs a desktop window to it
  ([test against a remote Node](../../local-development/remote-node.md)). It proves the client
  handles a different filesystem, user, and loopback, but it shares the Mac's network and never
  sleeps or reboots.
- [The smoke checklist](../../testing/smoke-checklist.md) covers the desktop on one machine.
- Each earlier phase lists its own by-hand checks. This phase runs them again together, from
  downloaded artifacts.

## Machines

Use these Node machines. Record each one's model, memory, operating system version, and network:

| Machine | Why |
| --- | --- |
| A Raspberry Pi 4 or 5 with Raspberry Pi OS 64-bit | The low-end Linux arm64 case, and the glibc floor |
| A Linux x64 machine running Ubuntu 22.04 server, with no desktop | A machine reached only over SSH |
| A Windows 11 x64 machine | Windows stop, pairing without signals, the scheduled task, and the firewall prompt |
| A Mac with Apple silicon | The LaunchAgent, quarantine, and tray mode |
| An Intel Mac, if one is available | The `darwin-x64` archive |

The client is the desktop on a second machine, plus the terminal client on a third where you can.

## Journeys

Run each journey on each Node machine unless it names one:

1. **Download and install.** Fetch the archive from a manual dispatch run, once with `gh run download`
   and once through a browser. Check it against its `.sha256`. Run the installer on a machine with no
   Node.js, npm, or compiler. Record the archive size and the install time.
2. **Run at login.** Run `acorn node service install`, reboot, and confirm `acorn node status` reports
   `running` before anyone opens a terminal. On Linux, confirm the Node survives the end of the SSH
   session that installed it.
3. **Reach and pair.** Run `acorn node reach <address>` and `acorn node pair`. On the client, add the
   Node in **Settings → Nodes**, compare the six words, and type the code. Pair the terminal client with
   `acorn --node https://<address>:<port>` and a second code. Repeat over Tailscale with a MagicDNS
   name.
4. **Do real work from the other machine.**
   - Add a project by typing a path on the Node.
   - Create a task.
   - Open a terminal pane and sign in a Claude Code account with the command that
     **Settings → Agents → Harnesses and defaults → Accounts** shows
     ([add an account](../../managed-agents/accounts.md#add-an-account)). Finish the sign-in in a
     browser on the client machine.
   - Start an agent, answer a permission request, and run a one-step workflow.
5. **Stay awake.** Set the Node machine's idle sleep to its shortest value. Start an agent turn that
   lasts longer than that, and confirm the machine stays awake. Once the agent finishes, confirm the
   machine sleeps on schedule.
6. **Revoke.** Run `acorn node devices`, then `acorn node revoke` on the client's device. The client's
   socket closes, and it reports the Node as revoked.
7. **Upgrade.** Install a second build over the first. The data, the paired devices, the service, and
   the account sign-in survive. After the client upgrades to the same tag, it doesn't ask to trust the
   bundled plugins again.
8. **Change networks.** Move the Node to a different IPv4 address. A client that dialed the address
   fails, and a client that dialed a name keeps working. Record the error the first client shows.
9. **Stop on Windows.** With an agent running, run `acorn node stop`. The Node's log shows the drain,
   the lock releases, and the next start doesn't report another Node holding the data root.
10. **Remove.** Uninstall. The command and the service are gone, and the data root remains.
11. **Tray mode**, on the Mac, Windows, and a Linux desktop:
    - Turn on **Keep the Node running when the window closes**, make the Node reachable, and pair the
      second machine's client.
    - Close the window. The client keeps working.
    - Check each tray item, a second launch, a dock click on macOS, and **Open acorn at login**.
    - Quit from the tray with an agent running, and confirm the quit prompt names it.

## Measurements

Record these with their date and machine:

- The Node's boot time and its memory after an hour idle with one client paired, on the Raspberry Pi.
- The helper's and the Node's memory with the desktop's window closed, on the Mac and on Windows.
- Each archive's compressed and extracted size.

## Findings

Record every failure on the testing page with its machine, its steps, and the phase that owns the
fix. Fix the Node-only journeys, 1 to 10, before you call the programme done. Tray mode can ship on its
own when journey 11 passes.

When the programme is done, move what shipped into its reference pages, remove this folder, and add
a row to "Completed plans removed" in [the future index](../README.md).

## Verify before building

- Check that a manual dispatch still keeps artifacts for 14 days, because the cap is a repository
  setting that can change.
- Check which Claude Code login flows work when the browser runs on a different machine from the CLI.
