# Computer Use approval checks

Run these checks when you change how a managed Codex session asks for app access through Computer Use.
[Managed agents](../managed-agents.md) § App-access approval owns the behavior. The numbers keep their
original acceptance-check IDs.

Run them on macOS with Computer Use installed, against a `pnpm dev:agent` session whose app has no
saved grant. Record the codex-cli, Computer Use, macOS, and Acorn versions with the result.

149. From a managed Codex session, ask the agent to read the test app's state through Computer Use,
     addressing the path that `pnpm dev:agent:ui -- target` reports. Confirm that the card names
     **Acorn Agent Test (com.acorn.desktop.agent-test)** and offers **Allow for this session**,
     **Always allow**, and **Decline**. Reach **Always allow** with the keyboard alone. Save the
     sanitized request `_meta` beside `plugins/agents/src/server/drivers/__fixtures__/codexComputerUseApproval.json`
     and correct the fixture where the two differ.
150. After **Always allow** in check 149, start a new managed session and ask again: no card appears.
     Quit Acorn and Codex, start them again, and ask again: no card. Stop the session, start one with a
     different name, and ask again: no card, because every session shares the identifier.
151. In a fresh session, choose **Allow for this session**. Ask again in the same session: no card.
     Ask in a new session: the card appears.
152. Revoke the grant in the ChatGPT app's Computer Use settings. Ask again: the card appears, and the
     old session's history still reads as it did. Note whether an action already running finished.
153. With the installed Acorn and two `dev:agent` sessions open, have each session's agent address its
     own `target` path. Confirm that each acts only on its own window, that `target` lists the other
     session under `sharedWith`, and that a native menu in one window is reachable while the other
     receives no input.
154. Stop a session, then run `target` and `stop` against its name: both refuse. Start it again and
     confirm that `target` reports the new process.
