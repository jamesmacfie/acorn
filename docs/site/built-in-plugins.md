# Built-in plugin pages

This page covers how the public site lists the plugins acorn ships, and the test that keeps the list
whole. Read it when you add a built-in plugin, or a permission to an installed package. It's part of
[the public site](../site.md).

## The data entry

Each plugin acorn ships has an entry in `apps/site/src/data/plugins.ts`: its name, one sentence, a Lucide
icon, whether it's part of the app or an installed package, which clients draw it, and its docs page.
`/plugins/` draws a card from each entry, and the Built-in plugins overview draws a table row.

The docs page is under `apps/site/src/content/docs/docs/built-in-plugins/`. Its facts box is the
`PluginFacts` component. **Ships as** and **Works in** come from the entry. For an installed package,
**Can reach** lists every permission the plugin's `acorn-plugin.config.mjs` asks for, each beside the
reason the entry's `reasons` gives for it. The build fails on a permission with no reason.

## The test

`apps/site/scripts/pluginPages.test.mjs` reads the compiled roster from the desktop, terminal client, and
Node activation lists, and the installed packages from `BUNDLED_PLUGINS`. It fails when:

- A plugin that ships has no entry, or its entry has no docs page.
- An entry lists a plugin that doesn't ship, or says it ships the other way.
- A manifest asks for a permission that has no reason, or a reason names a permission nobody asks for.

So a new built-in plugin, or a new permission, needs its entry and its reason before the site's tests
pass. The test runs with the site's other script tests.
