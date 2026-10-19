# Context references in both clients, October 19, 2026

This page records one check of `#` context references in a real desktop window and a real terminal
client, with real Claude Code and Codex sessions. It's the evidence for
[referencing Acorn context](../managed-agents/composer.md#reference-acorn-context). The check ran on
the `context-2` branch at `aa63eb1cc`.

## How to rerun

1. Run `pnpm dev:agent -- --session ctx-refs`. When it prints `ready`, create a task with **New task**
   and **Project folder**, so no worktree or branch is made.
2. Start a Claude Code session and send it a codeword, such as "Remember the codeword PINEAPPLE-42.
   Reply with just OK and use no tools."
3. Start a second Claude Code session. Type `#`, choose `#agent`, choose the first session, then ask
   for the codeword and which `acorn-context` block it came from. Send it.
4. Start a Codex session and type the same `#agent:<slug>` token by hand. Send the same question.
5. Open a terminal and print some lines and a fake token, such as
   `echo "export API_TOKEN=sk-live-abcdefghijklmnop"`. In a session's composer, open **Context**,
   choose **Terminal sessions**, tick the shell, press **Done**, and ask what the shell printed.
6. For the terminal client, run `pnpm dev:tui:agent -- --session ctx-tui --cols 120 --rows 40` and
   repeat steps 1 to 3 and 5 with the keyboard. From the pane strip, Down then Right twice puts the
   keys in the composer.

The driver's `click` can hang on a button that navigates. A `run` script that calls
`element.click()` works. A `run` script can't type into a desktop terminal reliably, so step 5 sent
its command through the terminal's hidden textarea.

## What it showed

On the desktop, `#` listed six sources: `#agent`, `#docker`, `#http`, `#db`, `#task`, and
`#terminal`. Choosing `#agent` wrote `#agent:` with no space and listed the one other session, not the
session being written to. Choosing it wrote `#agent:codeword-memory-test` and a space, drew the
token with a dotted underline, and gave it the tooltip `Codeword memory test · Agent sessions`.

Claude Code answered `PINEAPPLE-42` and named the block by its label and its
`ref="#agent:codeword-memory-test"`. Codex, given the hand-typed token, answered
`PINEAPPLE-42 — Session · Codeword memory test`. In both transcripts the sent token was a link, and
pressing it opened the first session.

The terminal output route answered 200 lines when the shell had printed more than 300. The fake token
line came back as `export API_TOKEN=<redacted>`. Codex, given `#terminal:shell`, answered
`ERROR: build failed; no API token is visible.`

In the **Context** list, a tick wrote `#terminal:shell` into the draft and an untick removed it.
Escape stepped back from the shells to the sources, and a second Escape closed the list. **Done**
closed it and put the caret back in the field after the token.

In the field, `#` and `#ta` opened the list. `#1`, `# Heading`, and `C#` didn't.

In the terminal client, `#` listed the sources and Enter on `#agent` stepped into the session list
with `Loading…` while it read. Enter again wrote the token. The **Context** list stepped into
**Terminal sessions** with a cleared filter, a tick added `#terminal:shell` at the end of the draft,
and Escape stepped back, then closed the list on the **Context** button. Claude Code answered with
the other session's codeword and what the shell showed. The sent message drew its tokens as plain
text with no fragment after them.

## Not checked here

- The terminal client listed four sources, not six. `#http` and `#db` come from loaded plugins, and
  their absence there wasn't traced. The desktop listed both.
- A `#task` token dropping the automatic task-context chip, a capture that fails or times out, a
  loaded plugin with `search` or a taken keyword, and two sessions with one title. Unit and host
  tests cover them: `plugins/agents/src/client/composer/contextReferences.test.ts` and
  `packages/client-core/src/host/chrome/chromeRegister.test.ts`.
- **Done** returning the keys to the field in the terminal client. Focus stays on the **Context**
  button there.
