---
title: Ask about an element
description: Point at part of a task's page, ask the task's agent about it, and what the extension sends with your question.
sources:
  - docs/browser-extension/element-picker.md
  - apps/extension/src/background/askElement.ts
  - apps/extension/src/content/picker.ts
checked: 832747727
---

On a page that belongs to a task, such as the app the task is building, you can point at one part of the
page, a button or a table, and ask the task's agent about it. The agent gets the element's HTML, where
it is in the page, and a screenshot of it. This page covers how to ask and what's sent.

## Ask about an element

1. Right-click the element and choose **Ask Acorn about this element**. Or choose **Ask about an
   element** from the task chip's menu, then click the element. An outline follows the pointer while you
   choose, and the page doesn't see the click. Esc cancels.

   A box opens beside the element.

2. Type your question.
3. **To** says where it goes. It starts on a new chat with the agent you used last time. To change
   it, click **To** and pick another agent's new chat, or one of the task's conversations.
4. Click **Send**, or press Enter. Shift+Enter adds a line.

   The panel opens on the conversation, where the reply arrives.

In Firefox, the box says **Sent. Click Acorn in the toolbar to see the reply.**, because Firefox opens
its panel only from the toolbar.

Esc, switching tab, or leaving the page closes the box and sends nothing.

## What's sent

| Part | What it holds |
| --- | --- |
| Your question | As you typed it. |
| The element | The page's address, a CSS path to the element, its size, and its HTML. |
| A screenshot | The visible page, cropped to the element with a little space around it. |

Before sending, the extension cleans the HTML: it removes scripts, styles, hidden inputs, event
handlers, and every field's value, so nothing typed into a form goes with it. Embedded images become
`[data URL]`. Classes, IDs, ARIA attributes, and `data-*` attributes stay, because they're how an agent
finds the component in the code. HTML over 50 KB is cut short, with a note saying how much.

If the browser won't take the screenshot, the question goes without one, and the box says so first.

## Limits

- It works only on a page that belongs to a task. On any other page, the panel opens and says why.
- On a page that belongs to more than one task, it asks the first.
- An element inside a frame can't be picked.
- Picking from the chip's menu sends a screenshot only if you clicked the Acorn toolbar button on that
  tab first. The right-click entry always can.
- A question can be up to 20,000 characters.
