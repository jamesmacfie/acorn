import type { ScaffoldPackage } from '../server/plugins/scaffold'

// A stand-in for `create-acorn-plugin`, which node-core can't depend on: that package's tests depend on
// node-core. Its files name the kind they were asked for, so a test can see which starter it got.
export const testScaffoldPackage: ScaffoldPackage = {
  scaffoldFiles: (id, name, options) => ({
    'acorn-plugin.json': `${JSON.stringify({ id, name })}\n`,
    'node/index.js': options.dataSource ? `// data source: ${options.dataSource.row}\n` : '',
    'client.js': options.trigger ? '// trigger\n' : '// pane\n',
  }),
  toPluginId: (input) => (/^(?=.{2,32}$)[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(String(input)) ? String(input) : null),
  SOURCE_REF: /^[a-z][a-z0-9-]{1,31}:[A-Za-z0-9._:-]{1,200}$/,
}
