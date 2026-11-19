# Phase 6: acceptance

Date: November 19, 2026. Status: proposed. Depends on phases 1 to 5, and on the hosted gateway for
the live run.

## Goal

Show the whole flow working on this computer first, then against a real Slack workspace, then in
production, and release it.

## Test locally first

Climb these four stages in order. Each one finds a different kind of fault, and only the last needs
anything deployed:

| Stage | What runs | What it proves |
| --- | --- | --- |
| 1. The stand-in | `pnpm dev:account` with the fake Slack, a local relay, and a `pnpm dev:agent` Node | Phases 1 to 5 against the contract, with nothing real |
| 2. The hosted service, locally, with the fake Slack | The hosted service on this computer in its test mode, a local relay in account mode, a `dev:agent` Node pointed at the service, and the [standalone fake Slack](../../account-api/slack-gateway.md#test-an-implementation) | The real gateway's routing, storage, delivery, and calls, plus the conformance suite |
| 3. The hosted service, locally, with real Slack | Stage 2 with real Slack in place of the fake one, reaching this computer through a tunnel with a fixed public address, as a separate dev Slack app installed in the test sandbox | Slack's real payloads, signatures, limits, and Block Kit rendering, before anything ships |
| 4. Production | The released Node and the deployed hosted service, with the production app installed in the test sandbox | The release itself |

The dev app in stage 3 is a second Slack app made from [the manifest](../../account-api/slack-app.md#the-manifest),
with every address pointing at the tunnel. Make it in the test sandbox, so it needs no public
distribution. Its credentials are kept apart from production's.

## Prepare a test workspace

The live run needs a Slack workspace that isn't a real team's. A Slack developer sandbox is the right
one: it's free, it's an Enterprise Grid org, and nobody else is in it.

1. Join the Slack Developer Program with the same email as your Slack account.
2. Sign the Slack CLI in to any workspace you belong to. `slack login --no-prompt` prints a
   `/slackauthticket` line. Send it in that workspace, approve, and pass the challenge code to
   `slack login --ticket <ticket> --challenge <code>`.
3. Run `slack sandbox create --team <team ID> --name <name>`. Leave out `--password`, so sign-in is
   by an emailed link.
4. Open the `.enterprise.slack.com` address that command prints, and sign in.
5. Sign the CLI in to the sandbox the same way as step 2.
6. Install the Acorn app in the sandbox through **Add to Slack**, with public distribution on.

A basic sandbox is archived after a month without use, so create it close to the live run, or add a
payment method to keep it. Adding one doesn't charge anything.

## Steps

1. **The stand-in walk.** In `pnpm dev:agent` with `pnpm dev:account`, link a fake Slack user, then go
   through each of these:
   - A mention in a channel with no default, and the picker.
   - Two DMs, which start two sessions in one "Slack DM" task, and a channel switched to
     conversation mode with `/acorn mode`.
   - A turn with an approval answered from Slack.
   - A guest reply, then a second owner message.
   - A turn typed in the desktop composer.
   - A Node restart during a turn.
   - The Node stopped, then a mention.
   - The task archived, then a reply and a fresh mention in its thread.
   - One session archived in a conversation task, which ends only its own thread.

   Check every Slack call the stand-in recorded against [the conversation rules](../../integrations/slack/conversation-rules.md).
2. **The live run.** With the hosted gateway deployed, install the app in a test Slack workspace. Link
   two Slack users to two Nodes, and repeat step 1 from Slack on a phone and on a computer. Check
   that each person's posts read "Acorn · <name>", and that one person's reply in the other's thread
   is context only.
3. **Rate limits.** Run three Slack tasks at once on two Nodes in one workspace, and check that status
   edits slow down and that no answer is lost.
4. **Size.** Build the Node, read the service size against its ceiling, and raise the ceiling by the
   growth, as [the rules for the work](./README.md#rules-for-the-work) allow.

## Release order

The hosted service builds from this repository's `main`, so the order matters:

1. Merge phases 1 to 5 to `main`, with stages 1 and 2 passing.
2. Load the hosted service's Slack secrets, staged, then deploy it. Its deploy is its release.
3. Add the event subscriptions to the production Slack app. Slack checks the events address when
   it's saved, so this waits for the deploy. Turn on public distribution, and set an icon.
4. Tag the next version here. As with earlier releases, the GitHub release carries the Node archives,
   and the site redeploys. Desktop installers stay off it until Apple signing exists.
5. Install the production app in the test sandbox, link a Node running the release, and run steps 2
   and 3 above.

## Checkpoint

Record each step's date and result here, with what the gateway logged about stored data. It should
show IDs only.
