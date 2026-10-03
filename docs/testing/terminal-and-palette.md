# Terminal and palette checks

Run these checks when changing terminal key handling or the shared command palette.
The numbers retain their original acceptance-check IDs.

The next four are the terminal keyboard's, from the programme that ended on 2026-09-02 by rewriting
[tui.md](../tui/keys.md) § Keys and focus. Every one of them needs a real terminal and none can be
automated: both harnesses ask for the kitty keyboard protocol, the trust queue is stubbed, and a
suite drives one task at a time.

27. Answer the plugin trust prompt at boot, against a real node offering a bundle this device has
    never decided about. The caret starts inside the dialog, Tab does not move it out, Enter on "Run
    it" records the decision, and Escape drops the queue entry. The harness stubs `pendingTrust`; the
    real flow comes through custody, which is the half no test sees
    ([tui.md](../tui/plugins.md) § The trust prompt).
28. Press Shift+Tab in a terminal that does not negotiate the kitty keyboard protocol. Both harnesses
    ask for it and get it, so a legacy terminal's spelling of that chord is untested; check that the
    region cycle still goes backwards, and that a lone Escape still leaves a rectangle without
    waiting out the parser.
29. Enter a PTY, then let a notification activate another task while the keys are inside it. Open the
    palette with its chord from inside the PTY, close it, and type again. Run it with
    `ACORN_TUI_KEYS_TRACE=1` and read `keys.log`: no line may say `reason=no-match` on a key the
    footer offers, and none may say `region=none` while the screen has regions
    ([tui.md](../tui/footer.md) § Seeing what the keys did).
30. Walk the cross and page keys where five different rules used to live. In a `list-detail` pane,
    Right crosses from the list to the detail, Left comes back, and PageDown lands on the last row
    and then scrolls the panel instead of wrapping. On the first tab of a `Sections` strip, Left goes one
    column left rather than doing nothing. In the editor's file tree, Right on a leaf reaches the
    document beside the tree.

The next twelve are the command palette's, owed since the graph and the shared session shipped on
2026-09-03 and **not yet run**. The session has a fixture suite both hosts pass and every route has
its own, and what none of them can see is the surface: the suites drive a store and assert its rows,
while a palette is a thing a person opens over a task they are in the middle of. Run them on the
desktop and in `acorn` in a terminal, and expect the two to agree.

31. Open the palette on ⌘K with nothing typed. The top level lists the groups and the loose commands
    and nothing else. Type a word that only a nested command matches — `archive`, `theme`, a run
    target's name — and it appears with the trail it came from beside it.
32. Enter a group, type inside it, enter a second group, then press Escape twice. Each frame comes
    back with exactly the query and the cursor position it was left with, and the focus you had before
    the palette opened comes back only on the last Escape.
33. Press ⌘P with a task open. The palette opens straight at the editor's file search rather than at
    the root, and picking a file opens it. Press `/` on a pull request; the same, at the changed-file
    search. Neither chord opens a second dialog.
34. Type quickly into a Rollbar or Linear issue search on a slow connection. One request goes out for
    the text you stopped on, an earlier answer arriving late never replaces it, and Escape while it is
    in flight leaves nothing behind.
35. Submit `Generate SQL` with a prompt that fails — no model connection, or a database that is not
    reachable. The frame stays open, your prompt is still in the field, the message says what to do,
    and Enter tries again. A second Enter while the first is in flight does nothing.
36. Change the theme from the Appearance setting command. The list marks the value that is set,
    picking one restyles the app immediately, the frame stays open, and the marker moves to what was
    actually stored. Open Settings → Appearance: it agrees.
37. With the palette open over a task, switch node or task from another window or another pane. The
    palette closes rather than acting on rows fetched for somewhere else.
38. Open a plugin's search frame, then disable that plugin from Settings → Plugins → Installed. The frame closes,
    nothing is invoked, and the plugin's whole group is gone from the root. Re-enable it: the group and
    everything under it come back, once.
39. Find a Rollbar issue from the palette and pick it. The URL changes and the surface beside the rail
    list shows that item, exactly as clicking the same row in the rail does.
40. Run `Generate SQL` successfully with the Database pane already open and with it closed. Both end
    with the generated SQL in the editor — the open pane re-reads the scratch document rather than
    keeping the text it had loaded.
41. Run and then stop a configured terminal target from the palette. The run/stop decision and the
    error copy match what the drawer shows, and a broken `.acorn/config.toml` still explains itself in
    the list rather than yielding an empty one.
42. Launch a workflow definition from the palette. It starts exactly as launching it from its own
    surface does, and no approve, cancel or kill row is offered anywhere in the palette.
