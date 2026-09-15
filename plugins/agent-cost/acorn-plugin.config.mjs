// A deliberately portable, client-only loaded plugin. Its remote tree can move to another repository
// without importing Acorn's compiled client or manufacturing a node lifecycle it does not need.
export default {
  name: 'Agent session cost',
  client: { entry: './src/tree/index.tsx', treeModule: 'acorn-plugin-sdk/remote' },
  permissions: {
    api: [],
    events: [],
    node: {
      core: [],
      capabilities: [],
      secrets: false,
      exec: false,
      net: [],
    },
  },
  contributions: {
    extensions: [{
      id: 'session-header',
      point: 'agents:session-header',
      label: 'Session cost',
      remote: 'sessionCost',
      order: 10,
    }],
  },
}
