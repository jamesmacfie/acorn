# The landing page's phone pictures

This page covers the two phone screens on the landing page and how they were taken.
[Shell snapshots](../snapshots.md) covers the window captures.

The landing page's two phone screens aren't snapshots. They're screenshots of the
[mobile web app](../../mobile.md) at 390 by 844, in `apps/site/public/phone/`, each taken in Catppuccin
Latte and in Mocha. The page shows the one that matches its light or dark mode. No capture scene draws
them, and nothing checks them against the code, so retake them by hand after a visible change to the
phone's shell, Needs you, or the agent pane. On October 29, 2026 they were taken this way:

1. `pnpm dev:account`, then `node scripts/agent-tui.mjs --session <name> --fixture site-snapshots`
   to seed the fixture. Only the seeding has to succeed.
2. A standalone Node on that session's `data` folder, started from `apps/node` with
   `node --import tsx src/entries/standalone.ts`, `ACORN_ACCOUNT_URL` set to the stand-in account
   service, and `ACORN_LAUNCHER_PIPES=1`, which hands back its device token. With that token, sign the
   Node in through `/v1/p/account/auth/device/start` and `poll`, then `PUT /v1/p/account/remote-access`.
3. Two more agent sessions in the Node's `plugins/agents.sqlite`, with `attention` set to `permission`
   and `question`, so Needs you lists three agents.
4. `pnpm dev:mobile`, driven in Playwright at 390 by 844 in UTC: sign in, press **Connect**, and approve
   the pairing with `POST /v1/core/pair/requests/:id`. Set the phone's device preferences to follow the
   system, Latte by day and Mocha by night, then capture each screen in each color scheme.
5. `cwebp -q 82 -resize 780 0` turns each capture into the WebP the page loads.

Leave out the account's list of Nodes, which shows the computer's name.
