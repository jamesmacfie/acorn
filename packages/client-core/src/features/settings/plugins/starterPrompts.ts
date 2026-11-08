// The drafts Create plugin leaves in the new session's composer (docs/plugins/agent-install.md §
// Teaching the agent). The teaching lives in the `plugin_authoring` tool these name, not in the text;
// that tool's test asserts this file still names it. Each draft ends on an open line for the person
// to finish, because nothing sends it for them.

type StarterTarget = { folder: string; pluginId: string; name: string }

const installCall = (folder: string) =>
  `plugin_request { action: "install", source: { path: ${JSON.stringify(folder)} }, dev: true }`

export function pluginStarterPrompt(target: StarterTarget & { kind: 'pane' | 'trigger' }): string {
  return `I want to extend acorn with a plugin, "${target.name}".

This folder, ${target.folder}, is the plugin's package. Acorn wrote it from the plugin scaffold: its acorn-plugin.json declares the plugin "${target.pluginId}" with a starter ${target.kind}. Run \`npm install\` first.

Call the \`plugin_authoring\` tool first. It returns the authoring contract and this node's own manifest
vocabulary, and an answer from memory will be wrong. When the plugin works, ask me for the package with
${installCall(target.folder)}, so I approve once and you can iterate.

What it should do: `
}

/** The derived data source draft (docs/plugin-authoring/derived-sources.md). It names each input by id,
 *  and the agent reads each input's fields with `data_source_describe`, because the Plugins page can't
 *  describe a source without an account. */
export function dataSourceStarterPrompt(
  target: StarterTarget & { row: string; inputs: { source: string; name: string }[] },
): string {
  return `I want an acorn plugin with a derived data source, "${target.name}": rows my own rules build from data acorn already reads.

This folder, ${target.folder}, is the plugin's package. Acorn wrote it from the plugin scaffold: its acorn-plugin.json declares the plugin "${target.pluginId}", the source uses \`defineDerivedSource\` from \`acorn-plugin-sdk/data\`, and its test uses \`testDerivedSource\` and \`fixtures\` from \`acorn-plugin-sdk/testing\`. Run \`npm install\` first.

Call the \`plugin_authoring\` tool first, and follow its section on derived data sources. Read each input's
fields with \`data_source_describe\`, and build test records with \`fixtures\`, which checks field names
against the real source. When \`npm test\` passes, run \`npm run build\` and ask me for the package with
${installCall(target.folder)}.

One row is: ${target.row}

It reads:
${target.inputs.map((input) => `- ${input.name} (\`${input.source}\`)`).join('\n')}

The rules for each row: `
}
