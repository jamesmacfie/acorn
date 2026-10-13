# Phase 10: acceptance that needs a person

Status: open, October 13, 2026. Nothing below has been run.

These checks finish the [developer release](./10-developer-release.md). An agent can't run them: they
need a browser prompt, a click on the browser's own toolbar or an OS notification, a real provider
account, a second computer, or the desktop app closed. Follow them in order. Write what you saw in each
**Result** cell, with the browser versions, and move each passed row into
[phase 10's results](./10-developer-release.md#real-browser-results).

## Before you start

1. Pack the release with `pnpm pack:node`.
2. Unpack the archive outside the checkout, and run `npm ci --omit=dev` and
   `node scripts/prune-runtime.mjs` inside it.
3. Run `pnpm --filter @acorn/extension build` in the checkout.
4. Have ready: your GitHub, Linear, and Rollbar accounts connected in the desktop, a second Mac on the
   same network, and a GitHub pull request, a Linear issue, and a Rollbar item you can open.

[Set up and troubleshoot](../../browser-extension/setup.md) has the steps behind each row.

## Checklist

| # | Do | Expect | Result |
| --- | --- | --- | --- |
| 1 | In your own terminal, run `node bin/acorn.mjs browser install`, then `browser status`, from the unpacked archive. | Both browsers `registered`, no problem. | |
| 2 | Quit the desktop app. Run `node bin/acorn.mjs node start --background`. | A Node starts on the desktop's data root. The desktop stays closed for rows 3 to 21. | |
| 3 | In your everyday Chrome, load `apps/extension/dist/chrome` with **Load unpacked**. Click the Acorn toolbar button. | ID `ciaaplnahgpccadenkacgipmhmpbddjo`. The side panel opens and says no Node is paired. | |
| 4 | Pair the Node from row 2. Get a code with `kill -USR1` on its process. | The words match the Node's. Projects listed. | |
| 5 | In Firefox, load `apps/extension/dist/firefox/manifest.json` with **Load Temporary Add-on**. Click the toolbar button and pair the same Node. | The sidebar opens. If it says the bridge didn't answer, **Retry** connects at once. Note which happened. | |
| 6 | On the second Mac, start a standalone Node with `ACORN_ADVERTISE_HOST` set to its address. Pair it in both browsers, then switch between the two Nodes. | Each Node shows its own projects and conversation. | |
| 7 | In Chrome's **Site access**, click **Allow** for github.com and accept Chrome's prompt. Open a pull request. | One **Open in Acorn** button in the header, without a reload. | |
| 8 | Click the button. Create a linked task, start a chat, and send the drafted context. | The card names the pull request and its project. The agent receives the pull request's context. | |
| 9 | Click the button again on the same pull request. | The linked task is listed first. No second task is created. | |
| 10 | Open a Linear issue, signed in. Allow linear.app. Use the sidebar's **Open in Acorn**. Create a linked task. | The issue resolves on your connection, and the task holds the issue link. Note the page address. | |
| 11 | Open a Rollbar item's `rollbar.com/item/<id>/` address, signed in. Allow rollbar.com. Hand it off. | The item resolves to its project counter, and the task holds it. Note the address Rollbar settles on. | |
| 12 | In Chrome's **Site access**, click **Remove** for github.com. | The page's button goes, and so does the sidebar's offer. | |
| 13 | In Firefox, on an ordinary page, click the toolbar button, then add a link, a selection, and a screenshot. Send them. | The screenshot is taken, and one message holds all three. | |
| 14 | In Chrome, on an allowed site, add a screenshot without clicking the toolbar. | The screenshot is taken through the site grant. | |
| 15 | Tick **Notify me when an agent waits** in Chrome and accept the prompt. On a page associated with a project, make an agent in that project ask a question. | Badge `1`. One OS notification: "An agent has a question for you. Open Acorn to answer." No request text. | |
| 16 | Click the notification. | Note whether the panel opens. Either way, opening the panel shows that conversation. | |
| 17 | Lock the screen while a notification arrives. | No request content on the lock screen. | |
| 18 | In a Claude Code conversation in Default mode, ask it to delete a throwaway folder in `/tmp`. Answer the permission card from the sidebar with **Allow**. | The card shows the command and its scope. The folder is deleted, and the card shows the answer. | |
| 19 | Ask an agent a question with several choices, then one that wants a written answer. Answer both in the sidebar. | The agent receives each answer. | |
| 20 | Freeze the Node with `kill -STOP`, press an answer, then `kill -CONT`. | The card reads the request again. Nothing is sent twice. | |
| 21 | Quit and reopen Chrome. | The extension is still installed. The badge returns before you open the panel, and the draft and conversation are restored. | |
| 22 | Open the desktop app. Raise a permission request. Press **Allow** in the desktop and in the sidebar as close together as you can. | One outcome. The other client shows it answered, with no buttons. | |
| 23 | With a request waiting, switch the sidebar to the other Node, then press its answer after switching back. | The answer goes to the request's own Node. | |
| 24 | In a checkout, from your own terminal, run `pnpm dev:extension -- --browser firefox --session p10-ff`. Edit `apps/extension/src/sidebar/App.tsx`, then press Ctrl-C. | Firefox opens with the extension. It reloads after the edit. The development registration is gone after stopping. | |
| 25 | Run `node bin/acorn.mjs browser uninstall`. Delete `~/Library/Application Support/acorn/browser-bridge/`. Revoke the browsers' devices on each Node with `DELETE /v1/core/devices/:id`. | Status says not installed. Both sidebars say the bridge isn't installed. | |

## What stays open after this list

- A request the sidebar can't answer, such as a workflow gate, can't be produced: nothing raises one.
- An app access request needs an agent that asks for app access. Check its scope and warning if one
  turns up.
- A secret answer needs a question marked secret. Check that the field hides what you type if one
  turns up.
