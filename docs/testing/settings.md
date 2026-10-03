# Settings, custom agent, and MCP server checks

Run these checks when you change settings pages, custom agents, or MCP servers. Run them in an
isolated `pnpm dev:agent` session unless a check says otherwise. Record the build, host, result, and
any issue for each check. The numbers keep their original acceptance-check IDs.

## Custom agents

100. Under Settings > Custom agents, make a Codex agent with high reasoning and one instruction line.
     Start it from **New**, from the empty pane's card, and from the palette's own "New *agent*
     session" row. Confirm that the composer shows high, the header chip names the agent, and asking
     the agent what it was told returns the instruction, including after a node restart resumes it.
101. Repeat check 100 on Claude Code, then edit the agent's instructions. Confirm that a running session
     keeps the old text and a new one gets the new text.
102. Install a loaded package whose manifest declares only `customAgents`. Confirm that the trust prompt
     shows the instructions in full, that the agent is listed with **Duplicate** but not **Edit**, and
     that disabling the package takes it out of **New**.

## The settings window

The following checks cover [frontend.md](../frontend/settings.md) § Settings. The rail's order, deep links, the
remembered page, and the settings-local node switcher have automated coverage in
`packages/client-core/src/features/settings/SettingsView.test.tsx`. These checks cover the window.

103. Open a task with a running agent session and a terminal running `top`. Press ⌘, and confirm that
     settings covers the whole window, top bar included. Wait ten seconds, press Escape, and confirm
     that the agent's transcript and `top` kept updating and that the terminal has focus again.
104. Open settings, click into the search field, and type into it. Confirm that nothing reaches the
     terminal underneath. Press F6 or the region chord from a rail row and confirm that focus stays
     in settings.
105. Walk every group in the rail and open each page once. Confirm that each page's body draws, that
     its breadcrumb names its group, and that the scope chip reads **This device**, **Node: <label>**,
     or **Workspace: <name>** as the page's registration says.
106. Pair a second node. On Installed, Security and backup, Audit log, Schedules, Run history, and
     Telemetry, switch the header to the second node and confirm that the page shows that node's
     data while the top bar's node, after closing settings, is still the first. On Services and
     on a loaded plugin's page, confirm that the chip is plain text naming the active node.
107. From the GitHub pane's shortcuts link, confirm that settings opens on **Keyboard shortcuts**.
     From the palette's **Settings** group, confirm that every page in the rail has a row and that
     picking one while settings is open moves to that page.
108. With a Select open on Appearance, press Escape once. Confirm that the list closes and settings
     stays open. Press Escape again and confirm that settings closes.
109. Narrow the window below 900 px. Confirm that the rail fills the window, that picking a page shows
     the page with a **‹ Settings** link, and that the link returns to the rail.

## Search, saving, and deep links

The next checks cover [frontend.md](../frontend/settings.md) § Search and deep links and § Pages and the save
model. Saved, a failed write, the unsaved-changes question on Escape, and search ranking with the
section highlight have automated coverage in `settingSave.test.tsx` and `SettingsView.test.tsx` beside
the view. These checks cover the window and the pages.

110. Walk every settings page. Confirm that no page has a **Save** button outside a form, and that
     every text field shows **Saved** beside its label after you change it and press Tab or Enter,
     and that the field keeps its width while it does.
111. Stop the node, or take the machine offline, and change a text field on a node page such as Limits
     and cost. Confirm that the field keeps what you typed and the row shows the error. Bring the
     node back and commit again, and confirm that **Saved** appears.
112. Type a declared section's keyword in the rail's search, for example `text size` for Terminal › Drawer.
     Confirm that the result reads **Page › Section** with a scope chip, and that Enter opens the page,
     scrolls to the section, and outlines it for about three seconds. With Reduce Motion on, confirm
     that the outline still shows. Repeat from the palette's **Settings** group, and with
     `openSettings('terminal#drawer')`.
113. Start a new schedule or edit an MCP server, type into it, and press Escape. Confirm that settings
     asks before discarding, that **Cancel** keeps the form, and that **Discard changes** closes
     settings. Repeat with a rail row and with **Back to acorn**.
114. On a page with a danger zone, such as a workspace's page, press its delete button. Confirm that the
     confirmation paints above settings and names what goes and what stays, and that **Cancel** leaves
     the workspace in place.
115. Change the terminal text size away from its default. Confirm that the row shows a dot and
     **Reset**, and that Reset puts the default back and the dot goes.

## Workspaces and projects

The next checks cover [frontend.md](../frontend/settings-groups.md) § Workspaces and projects. The run-targets table's
round trip, the read-only provenance row, Default's protection, a plugin's project tab, and the rail's
tree with ⌘[ have automated coverage in `RunTargetsTable.test.tsx`, `ProjectSettings.test.tsx`,
`WorkspaceSettings.test.tsx`, and `SettingsView.test.tsx`, and the node's `repoConfig` in
`packages/node-core/src/server/routes/projects/membership.test.ts`.

116. On Overview, select two projects in different workspaces. Confirm that the bar says **2 selected**,
     and that **Move to workspace**, **Hide**, **Set colour**, and **New workspace…** each change both
     rows and say so under the bar. Confirm that **Clear** empties the selection.
117. Open a workspace from the rail. Confirm that its projects appear under it only while it is
     expanded, that the chevron and the Right and Left arrows expand and collapse it, and that typing a
     project's name in the rail's search finds its page with the workspace collapsed.
118. Open a project from Overview, then press ⌘[. Confirm that it returns to Overview. Open the same
     project from its workspace's page and press ⌘[ twice: the workspace, then Overview. Confirm that
     the header reads **Project: <name>**, and names the node too with two paired.
119. Walk each tab of a project's page and change one field on each. Confirm that each shows **Saved**,
     and that the value is still there after closing and reopening settings.
120. Add, edit, and remove a run target from the table. Confirm that a task on that project shows the
     run buttons the table lists, and that a second default moves the default rather than adding one.
121. Commit a `.acorn/config.toml` to a project with a `[scripts.run.dev]` target, a `[database]
     url_script`, and a `[preview] mode`. Confirm that the dev script, the database connection script,
     and the preview URL rows read **From .acorn/config.toml**, cannot be edited, and show the file's
     value above this machine's. Delete the file and confirm that the rows are editable again.
122. Try to rename or delete Default from its page, from Overview, and from the rail. Confirm that
     none of them offers it.

## Agents, plugins, and connections

The next checks cover [frontend.md](../frontend/settings-groups.md) § Agents. The header's detail and back link, old
page ids, and the device chip have automated coverage in `SettingsView.test.tsx` and the terminal kit
test. The custom agent and MCP server editors, Harnesses and defaults, and both core pages are covered
in `plugins/agents/src/client/settings/*.test.tsx`, `AgentToolsSettings.test.tsx`, and
`McpSettings.test.tsx`, and the project MCP routes and the catalog's owners in
`packages/node-core/src/server/routes/projects/projects.test.ts` and `agentTools.test.ts`.

123. On Harnesses and defaults, turn **Send task context at startup** off, then open Claude Code in a
     task's terminal drawer. Confirm that no task context arrives. Turn it back on and confirm that the
     next one gets it, and that the Terminal page no longer shows the switch.
124. On Custom agents, create an agent, then edit it. Confirm that the editor opens in the pane, that
     the header names it with a back link, and that ⌘[ with an unsaved change asks before going back.
     Delete it from the danger zone and confirm that it leaves New and the palette.
125. On MCP servers, add a server, edit it, and remove it from its danger zone. Confirm that each step
     happens in the pane, that the list names `/mcp`, and that its link opens MCP config files.
126. With no task open, open MCP config files, pick a project with a committed `.mcp.json`, and note
     its servers. Open a task in that project, open the page again, and confirm that it starts on that
     project and lists the same servers.
127. On Tools and permissions, switch between **By owner** and **By tier**. Confirm that a loaded
     plugin's tools sit under its id, and that turning the Execute tier on and off moves every execute
     tool's switch.
128. From a queued agent turn's **Change** link, and with `openSettings('agent-pricing')`, confirm that
     Limits and cost opens on **Turns at once** and on **Claude prices**.
129. Under **Settings > Plugins > Installed**, install a GitHub package on the node and a client-only
     package on this device from **Install…**. Confirm that each target asks for trust, that the device
     plugin appears under **This device**, and that a package waiting for approval appears under
     **Needs you** with a dot on **Installed** in the settings rail.
130. On a plugin page, open each of **Overview**, **Settings**, **Permissions**, and **Versions**. Approve
     a staged package an agent requested, end dev mode for a plugin in development, and revoke one
     approval. Uninstall one plugin with **Keep its data** and another with **Delete its data**, and
     confirm that each confirmation names what goes and what stays.
131. Turn an optional node plugin off from its page's strip. Confirm that the strip says it is off, that
     the page still saves, that **Installed** shows the restart banner, and that the settings rail shows
     a dot until the node restarts. Turn a device plugin off from its strip and confirm that settings
     opens its page under **Installed**.
132. Open the plugin strip on a compiled plugin page (Docker), a remote tree (Sentry export), and a frame
     page. Confirm that the strip sits above the page, outside it, and stays in place while the page
     scrolls.
133. On **Rail and surfaces**, hide a plugin source. Confirm that its icon leaves the rail, that the
     palette offers **Open <source>** and opens it, that the source stays open after it is opened from
     the palette, and that hiding it while it is selected returns to Home. Reorder the rail while it is
     hidden, show it again, and confirm that it returns to its slot. In the terminal client, confirm
     that the source is still in the source menu.
134. With a switch whose write fails (stop the node, then flip **Hidden** on a project page), confirm
     that the switch returns to the stored value and the row shows the error. After confirming a
     danger-zone delete from a clicked button, confirm that Escape still closes settings.
135. With a real Linear key, connect it from **Settings > Connections > Services > Add connection**.
     Confirm that the Linear card asks for **Personal API key**, that typing a key and pressing Escape
     asks before it drops it, and that Save lands back on the list with the connection in it. Open
     **Add connection** again after connecting GitHub: its card says **Connected, one allowed** and
     opens the GitHub connection.
136. Revoke that Linear key at Linear, then press **Test** on its page. Confirm that it moves to the top
     of Services with an amber dot, that the settings rail shows the dot beside **Services**, that the
     bell has a row for it, and that its page starts with the refusal and **Replace key**. Replace the
     key and confirm that the dot, the row, and the banner all clear without reopening settings.
137. On a Linear connection's page, follow a project into one workspace from **Where it shows up**.
     Confirm that the workspace's page lists it under **Connections**, that the project's
     **Connections** tab lists it too, and that **Manage** there opens the connection's page. Search
     for the connection's name and confirm that Enter opens its page, not just Services.
138. On **AI models**, confirm that **Generate with** carries the **This device** chip, that an
     Anthropic key is listed under **API keys** and not on Services, and that an installed `claude`
     is listed under **Agent CLIs**. Search `startup context` and confirm that Enter lands on
     **Harnesses and defaults › New sessions**.
139. In the terminal client at 80 by 24, search `settings` in the palette and confirm that **Open
     settings** is the first row and opens the route on the nine groups. Open a page in each group and
     confirm that a page marked **desktop app** says why and where to go, that Escape climbs one level
     at a time with the caret back on the row it left, and that the plugin pages (Harnesses and
     defaults, Docker, Workflows) draw and scroll to their last row. Repeat at 120 by 40.
140. Start the terminal client with `ACORN_TUI_NOTIFY=bell`, then with no value, and open
     **Settings > General > Notifications**. Confirm that **Terminal alerts** says **Bell only** and
     **From ACORN_TUI_NOTIFY**, then **Bell and terminal notification** and **The default**. In a
     terminal acorn has no notification sequence for (Apple Terminal), confirm that the row says only
     the bell reaches you. Turn **An agent needs me** off and confirm that the change survives a
     restart, then press **Send a test** and confirm that the terminal rings.
141. In the terminal client, add an MCP server or a custom agent, type into its form, and press Escape.
     Confirm that **Discard unsaved changes?** opens with the caret on **Cancel**, that Cancel keeps
     the typed value, and that **Discard changes** returns to the list. Save one, then remove it from
     its danger zone, and confirm that the confirmation names what goes and that the list no longer
     shows it.

## MCP servers

The following checks cover [mcp.md](../mcp.md) § Your own servers. The store, routes, runtime,
drivers, handoff flags, and test button have automated coverage in `plugins/agents`. These checks cover
the real harnesses and the window.

142. In Settings → MCP servers, add a stdio server with one secret environment variable and press
     **Test**. The tools are listed. Edit it, leave the secret empty, save, and test again: it still
     connects.
143. Open a Claude Code session and a Codex session, and ask each to call one of the server's tools.
     Type `/mcp` in each composer: the panel opens and nothing is sent. Codex lists every server it has
     with a status. Switch the server off, apply, and confirm that the transcript notes the restart and
     that the agent no longer has the tool while the conversation continues.
144. Continue each session in a terminal and run `/mcp` there. The server is listed. While the terminal
     runs, `ps -axww` shows the server's command but never its secret value.
