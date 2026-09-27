# Rail and annotation checks

Run these checks when changing task markers, rail layout, focus, or appearance.
The numbers retain their original acceptance-check IDs.

The task-annotation lifecycle's automated coverage described under Test layers was implemented on
2026-09-26. The following real-window and real-terminal checks keep the same host behavior reviewable
when the annotation or rail contracts change.

89. Check the rail under the Terminal, Modern, Cozy, and Cute style packs.
90. Check source, task, pane, run, terminal, add, and close controls at rest, hover, focus, active,
    and busy.
91. Confirm that the left add control and right close control occupy equal 52-pixel boxes with aligned
    dividers.
92. Confirm that project accent stripes stay on the left and right-rail active stripes stay on the
    right.
93. Open a task with pin, Docker, unread, working, dirty, checks, and loaded-plugin annotations.
    Confirm that markers do not overlap and that the tooltip and accessible description list every
    accepted state.
94. Turn on reduced motion and confirm that marker and busy animations stop.
95. Open and dismiss a task-row menu. Confirm that it anchors to the rail button and returns focus to
    that button.
96. Change a loaded plugin's task status without changing the task list. Confirm that its marker
    refreshes after a plugin push, global status, and declared polling.
97. Disable, enable, reload, and remove that plugin. Confirm that its marks disappear synchronously
    and return only while its contribution is eligible.
98. Switch between two nodes that contain the same task id. Delay one node's response and confirm
    that neither the delayed answer nor either retained mark appears on the other node.
99. In `acorn`, show more task markers than the row can fit. Confirm that the row shows `+N`, then
    focus it and press `Shift+F10` to inspect every marker label in the **Task markers** list.

Checks 96–99 passed on 2026-09-27 with an isolated `dev:agent` data root and a loaded fixture plugin.
The Tauri window refreshed only that plugin after its push, cleared marks across disable, enable,
reload, and removal, and switched between two nodes whose copied task databases contained the same
task id without retaining the other node's label. The real terminal projected six accepted markers
as `+6`; `Shift+F10` opened **Task markers**, and End reached the sixth label. That run also caught and
fixed a long-title layout that could previously shrink the disclosure out of the row.

One known appearance bug is recorded here so it is decided rather than slipped into an unrelated
diff: `:root:not([data-theme="light"])` under `prefers-color-scheme: dark` has the same specificity as
a named theme block and sets `--is-dark: 1`, so with the OS in dark mode the light-palette themes
`solarized-light` and `catppuccin-latte` tell xterm and CodeMirror they are dark while rendering light.
The fix is two lines and changes shipped visual behaviour for users of those two themes; it belongs
in its own change with its own note.
