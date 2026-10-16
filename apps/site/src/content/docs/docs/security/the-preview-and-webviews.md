---
title: The preview and webviews
description: What the preview pane and a plugin's web pages can load, why a remote Node's preview is refused, and how agents browse.
sources:
  - docs/security/webviews.md
  - docs/shell/webviews.md
  - docs/tui/rectangles.md
  - docs/first-party-plugins/terminal.md
checked: 52225e24f
---

This page covers the web pages acorn shows inside the desktop app: the preview pane, and pages a plugin
shows. It also covers the separate browser agents drive. Read it before you preview an app that handles
real data.

## The preview pane

The preview pane shows your app, such as a dev server, beside the task. It's a separate native webview,
not part of acorn's own window:

- **It loads only `http` and `https` addresses**, without a username or password in the address.
- **It has its own temporary storage**, so its cookies and logins aren't acorn's and don't outlive the
  app.
- **It can't call acorn.** acorn's own commands are granted only to acorn's main window, and the app
  checks the calling window before it runs one. A page in the preview has no way in.
- **It can't open new windows**, and its requests for permissions such as the camera are denied.

Another plugin can add up to four controls beside the preview's address bar, and ask it to reload. It
never gets the page or a way to navigate it.

## Why a remote Node's preview is refused

The preview pane refuses every address from a remote Node, public and loopback alike. The webview can
check where the page navigates, but not where its scripts send requests. A page from a remote Node
could reach services on your own network: your router, a NAS, a dev database. So only a Node acorn
knows is local can supply a preview, and switching a task to a remote Node closes its preview.

The pane says why. To look at an app on a remote Node, open its address in your own browser, where your
browser's own rules apply.

## A plugin's web pages

A plugin can show a page from the internet in a pane, such as a service's dashboard. Its trust prompt
lists the hosts under **Web pages**, as a grant of its own:

- The app enforces the host list on every navigation and redirect, and checks it twice, in two separate
  parts of the app.
- Each page gets its own temporary storage, apart from every other page.
- The plugin chooses the address, and nothing else. It gets no script injection, no developer tools,
  and no way to read or type into the page.

A plugin's own interface is different: it runs in a sandboxed frame or a worker, with no internet
access of its own ([Plugin trust and permissions](/docs/security/plugin-trust-and-permissions/)).

## Agent browser tools

Agents browse with their own browser on the Node, never your preview pane. The page you're looking at
isn't something an agent steers. The six `browser_` tools are in the **Execute tools** tier, off by
default.

- Each task gets its own browsing context, so cookies and logins one task's work set up never reach
  another task.
- An agent fills a field through the element it read, so a page can't swap in another element between
  reading and writing.
- The tools can't run arbitrary JavaScript in the page.
- Screenshots are kept per task, the newest 20, and only that task's agent and your devices can read
  them.

## In the terminal

The terminal client can't draw web pages, so it has no preview pane, and a
plugin's web page shows a line naming what's missing. Agent browser tools work the
same, because they run on the Node.

## Limits

- The preview is meant for your own app. A page in it can still do anything a web page can do on your
  network, from your computer.
- A plugin's web page keeps its cookies and logins until the app quits.
- Previewing an app on a remote Node needs your own browser.
