---
title: Send pages, selections, and screenshots
description: Put a page's selected text, its link, or an item from a site into an agent conversation's draft, what the agent receives, and which pages the extension can read.
sources:
  - docs/browser-extension/page-capture.md
  - docs/browser-extension/handoffs.md
  - apps/extension/src/capture.ts
  - apps/extension/src/background/selectionMenu.ts
  - apps/extension/src/sidebar/Composer.tsx
  - apps/extension/src/sidebar/Workspace.tsx
  - apps/extension/src/sidebar/Home.tsx
  - apps/extension/src/sidebar/Agents.tsx
checked: 832747727
---

The extension can put what's on the page into an agent conversation: text you selected, the page's
link, or the item a site shows, such as a pull request. Each one waits in the draft until you send.
This page covers each way in, what the agent receives, and which pages the extension can read.

## Add selected text

1. Select text on the page, right-click it, and choose **Add to Acorn chat**.

   The panel opens on the conversation you last had open, or the newest in the task you last opened, with
   the text in the draft as a **Selected text** chip.

2. Add a message if you like, and click **Send**.

If there's nowhere for the text to go, such as no task opened yet, or a task with no conversation, the
panel opens and says so in one line, and adds nothing.

## Add the page's link

On a page that belongs to a task, open the task chip's menu and choose **New chat about this page**
([Task chips and handoffs](/docs/browser-extension/task-chips-and-handoffs/#the-task-chip)). The panel
opens on the task's **Agents** tab, with the page as a chip that **goes with your first message**.
Open or start a conversation in that task, and the link is in its draft as a **Page** chip. The ×
on the chip drops it.

## Add an item from a site

After **Create task** on the handoff card, the item, such as the pull request with its description,
waits on the new task's **Agents** tab in the same way and joins its first conversation's draft as an
**Item** chip. It waits only in that task, even after you close the panel. The same item added twice
is one chip.

## Send a screenshot

A screenshot goes with a question about part of the page: right-click it and choose **Ask Acorn about
this element**. acorn sends the element's HTML and a screenshot cropped to it ([Ask about an
element](/docs/browser-extension/ask-about-an-element/)).

## What the agent receives

Each chip in the draft shows what it holds. Open it to see the address and the text, and click **×** to
remove it. Nothing goes to the Node until you click **Send**.

| Chip | The agent receives |
| --- | --- |
| **Selected text** | The text, with the page's address and title. |
| **Page** | The page's address and title. |
| **Item** | What the site's plugin says about the item, such as its title and description. |

acorn marks page text as information from the browser, so a page can't put words in your mouth: text
on a page that looks like an instruction reaches the agent as part of the page, not as your message.

## Which pages the extension can read

The extension reads only the tab beside the panel, and only the top of the page, not frames inside it.
It can read a page when:

- You clicked the Acorn toolbar button on that tab, until it goes to another page.
- You used **Add to Acorn chat** or **Ask Acorn about this element** on it.
- You turned on its site's switch in the panel's **Settings** > **Sites**. That covers text and links, but
  not screenshots, which need the toolbar button or a right-click entry.

Clicking inside the panel grants nothing. With no access, the panel asks you to click the toolbar
button on the page.

## Limits

- One message can carry up to eight selections, links, and items, within 512 KiB of text in all.
- A screenshot over 5 MB is left out.
- Text selected inside a frame on the page reads as empty.
- If the browser's storage for the extension is full, a capture is dropped, and the panel says so.
