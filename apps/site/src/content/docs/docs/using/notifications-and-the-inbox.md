---
title: Notifications and the inbox
description: When acorn interrupts you about an agent, the four ways it can, the inbox, and the settings.
sources:
  - docs/notifications.md
  - docs/notifications/channels.md
  - docs/notifications/states-and-edges.md
  - docs/notifications/gate.md
  - docs/tui/chrome.md
  - packages/client-core/src/features/settings/NotificationSettings.tsx
  - packages/client-core/src/features/notifications/NotificationBell.tsx
checked: 'e7c7447f7'
---

This page covers when acorn tells you about an agent, the ways it can reach you, the inbox behind the
bell, and the settings that turn each part off. Read it when you run more than one agent and want to
know which one needs you.

## What acorn tells you about

acorn watches every agent session, managed or running in a terminal, and interrupts you for three
changes only:

| When | The notice says |
| --- | --- |
| An agent starts waiting for you: a permission, a question, or a workflow gate | **\<title\> needs you** |
| An agent finishes its turn | **\<title\> finished** |
| An agent fails, or its process exits with an error | **\<title\> failed** |

Everything else is quiet. An agent that carries on working after you answer, or after you send it
another message, raises nothing. A workflow reports once when its run ends, not once per step.

acorn waits one second before it tells you. If the agent has moved on by then, such as a permission
your settings answered on their own, nothing is sent.

### Seen means quiet

If the window has focus and you're on the task the notice is about, you've seen it. It still goes in
the bell, already read, and nothing else happens: no sound, no system notification, and the count
doesn't change.

## The four ways acorn reaches you

| Channel | When it fires |
| --- | --- |
| The bell | Always. The notice is a row in the bell's list. |
| A sound | When you haven't seen the notice. A rising chime means an agent needs you or failed, and a falling one means it finished. |
| A system notification | When you haven't seen the notice. Clicking it opens the task. It says what happened, never what the agent said. |
| A count on the app icon | Whenever the bell's count changes. It's the same number as the bell. |

## The inbox

Click the bell at the right of the top bar. It has two sections:

- **Needs you** lists what's waiting on you now, across every Node: a permission, a question, a
  workflow gate, or a finished turn you haven't read. These rows last until something changes, so a
  pending permission stays until you answer it.
- **Notifications** lists what happened, newest first. The bell keeps the last 50.

Click a row to go where it points: the task, the session, or the run. The count on the bell is the
unread notifications plus the rows in **Needs you**.

### Clear the count

- Open the session a row is about, in a window with focus, and its finished-turn row clears.
- Click **Mark all read** to mark every notification read and clear every finished-turn row.

A row that says an agent is blocked, or failed, stays until you act on it. Reading about a permission
doesn't answer it.

## Change the settings

Open **Settings** > **General** > **Notifications**.

1. Under **How acorn tells you**, turn **Play a sound**, **Show a system notification**, and **Show a
   count on the app icon** on or off.
2. Under **Notify me when**, turn **An agent needs me**, **An agent finishes**, and **An agent fails**
   on or off. Turning one off stops that notice everywhere, the bell included.
3. Click **Send a test** to check what you'll get. It's also where your system asks for permission to
   show notifications.

The same switches are in the command palette, under **Notifications**. These settings belong to this
device.

## In the terminal

The terminal client shows the count as `◔ N` at the right of its top bar, and nothing when there's
nothing waiting. Press `n` to open the inbox, with the same two sections. Enter on a row opens its task.

Instead of a system notification, it writes the terminal's own notification sequence, which iTerm2,
Ghostty, WezTerm, Warp, kitty, and rxvt understand, and a bell for the sound. Other terminals get the
bell only. It only notifies when the terminal doesn't have focus, if your terminal reports focus.

Set the `ACORN_TUI_NOTIFY` environment variable to choose: `off`, `bell`, `terminal`, or `both`, the
default. The terminal client's Settings page shows that choice and the three **Notify me when**
switches.

## Limits

- The bell keeps 50 notifications, on this device. They aren't stored on the Node.
- With **Keep the Node running when the window closes** on, this computer shows no notifications,
  sounds, or app icon count while the desktop window is closed. Clients on other machines still do
  ([General](/docs/settings/general/#background)).
- A system notification never includes what the agent said, or any file name or path.
- Notices from an installed plugin stay in the bell. They never become system notifications.
