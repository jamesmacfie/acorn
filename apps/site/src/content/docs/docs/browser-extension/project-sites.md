---
title: Project sites
description: Tie web addresses to a project so the browser panel suggests it on those pages, and pick another project for a site when the suggestion is wrong.
sources:
  - docs/browser-extension/project-sites.md
  - packages/protocol/src/projects/siteAssociations.ts
  - apps/extension/src/sidebar/Sites.tsx
  - apps/extension/src/sidebar/AddSite.tsx
  - apps/extension/src/pageScope.ts
checked: 3f99b39fc
---

A project site is a web address you tie to a project, such as its staging app or its docs. On those
pages, the browser panel suggests the project and lists its open tasks, so the task you need is one
click away. This page covers adding sites and choosing another project for a site.

## Add a site to a project

1. In the panel, open **Settings**. **Sites** lists every website the extension works on, and says
   which project each suggests.
2. Click **Add site**, and pick the project. It starts on the project of the task you last had open.
3. Choose a kind under **Match**, and type the address or pattern. Until you type, the box holds the
   page beside the panel, so the domain you're on is one click away. A green check says when what you
   typed covers that page, and the dialog says what's wrong with it before anything is saved.

To change or remove a project's site, click **⋯** on its row, then **Edit** or **Remove**.

| Kind | Example | Covers |
| --- | --- | --- |
| Starts with | `https://example.com/app` | That address and every page under it, by whole path parts: `/app/login`, not `/apps` |
| Domain | `example.com` | The domain and its subdomains, such as `app.example.com`, on any port |
| Exact page | `https://example.com/pricing` | That page, whatever its query or fragment |
| Regex | `^https://pr-\d+\.preview\.example\.com/` | Any address the pattern matches |

**Remove** beside a site deletes it. A project can have up to 32 sites. Sites are stored with the
project on the Node, so every browser paired with that Node sees them. A repository's
`.acorn/config.toml` can't set them.

## What a site does

On a page a project's site covers, Home's **This page** picks the project in its **Project** picker,
under **Suggested for this page**, and lists its open tasks. Click one to open it. **New task in
Acorn** opens the project in the desktop app.

- Several projects' sites can cover one page. Then the picker lists them first, under **Suggested for
  this page**, and the rest under **Other projects**, until you pick one.
- A page that belongs to a task, or that a plugin can bring into a task, shows that first.
- A site is only a suggestion. It grants the extension no access, and any task can still be chosen on
  any page.

The suggestion moves nothing by itself: the task or conversation the panel shows, and its draft, stay put
when the page changes. The [toolbar badge](/docs/browser-extension/waiting-requests-and-notifications/#the-toolbar-badge)
counts requests waiting in the projects a page suggests.

## Choose another project for a site

When the panel suggests the wrong project, pick another in **This page**. The panel remembers your
choice, in this browser, for that site, while the same projects are suggested there. Picking the
suggestion again forgets it. You can also pick no project.

## Site access

Matching a page to its sites needs only its address, which the extension already has. Seeing the
page's content, for chips and capture, needs access to the site. Each row under **Settings** >
**Sites** has a switch for that access. Turning it on asks the browser, and turning it off asks
nothing. The switch is only access: turning it off keeps the project's site, and the panel just can't
read those pages. Browsers grant access by host, not port, so a site at `http://localhost:5173` asks
for all of `http://localhost`.

## Limits

- The desktop app's project settings don't show project sites. Only the extension edits them.
- A regex names no host, so its row has no access switch.
- A pattern can be up to 500 characters.
