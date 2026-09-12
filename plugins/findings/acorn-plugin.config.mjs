const string = (maxLength, description) => ({ type: 'string', maxLength, ...(description ? { description } : {}) })

const evidence = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['repository', 'managed-turn', 'workflow-step', 'observation', 'memory-version', 'url'] },
    path: string(2_000), revision: string(200), label: string(200), sessionId: string(200),
    turnId: string(200), runId: string(200), stepId: string(200), observationId: string(200),
    memoryId: string(200), hash: string(200), url: string(2_048),
  },
}

const record = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceKey', 'title', 'body', 'claimStatus'],
  properties: {
    sourceKey: string(200), kind: string(240), kindVersion: { type: 'integer', minimum: 1, maximum: 1_000 },
    title: string(200), body: string(16_384), claimStatus: { type: 'string', enum: ['observed', 'inferred', 'asked'] },
    evidence: { type: 'array', maxItems: 20, items: evidence }, correctsObservationId: string(200),
  },
}

export default {
  name: 'Findings',
  entry: '@acorn/plugin-findings/node/index.ts',
  factory: 'findingsPlugin',
  client: { entry: './src/tree/index.tsx' },
  migrations: './migrations',
  permissions: {
    api: [],
    events: ['plugin:agents:turn-changed', 'plugins:changed'],
    node: {
      core: ['fs', 'tasks', 'projects:read', 'models', 'identity', 'prefs'],
      capabilities: ['agents.reviewInput.v1'],
      secrets: false,
      exec: false,
      net: [],
    },
  },
  emits: [
    { verb: 'observations-changed', description: 'A findings scope revision changed; re-read its quiet observation history' },
    { verb: 'review-changed', description: 'A prepared findings review projection changed' },
  ],
  contributions: {
    frames: [
      {
        target: 'pane',
        id: 'findings',
        label: 'Findings',
        glyph: 'list-checks',
        order: 50,
        layout: 'single', regions: { body: { kind: 'remote', entry: 'pane' } },
        destinations: [
          { id: 'memory-review', label: 'Review in Memory', targetKind: 'findings-candidate', noticeKind: 'memory-proposal' },
          { id: 'memory-bundles', label: 'Open Memory review', targetKind: 'findings-bundle', noticeKind: 'memory-proposal' },
        ],
      },
      {
        target: 'settings',
        id: 'findings-settings',
        label: 'Findings',
        glyph: 'list-checks',
        group: 'general',
        order: 55,
        layout: 'single', regions: { body: { kind: 'remote', entry: 'settings' } },
      },
    ],
    agentTools: [
      { id: 'record', description: 'Record one quiet, task-scoped observation with evidence. This creates no notification or review obligation.', inputSchema: record, risk: 'write', requiresSession: true, handler: '/v2/p/findings/runtime/tools/record', timeoutMs: 5_000, maxOutputBytes: 32_768 },
      { id: 'list', description: 'List this task’s observations with byte-aware cursor pagination, including withdrawn history when requested.', inputSchema: { type: 'object', additionalProperties: false, properties: { cursor: string(400), limit: { type: 'integer', minimum: 1, maximum: 100 }, state: { type: 'string', enum: ['active', 'history'] } } }, risk: 'read', handler: '/v2/p/findings/runtime/tools/list', timeoutMs: 5_000, maxOutputBytes: 262_144 },
      { id: 'get', description: 'Read one observation from this task, including evidence, corrections, and withdrawal history.', inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: string(200) } }, risk: 'read', handler: '/v2/p/findings/runtime/tools/get', timeoutMs: 5_000, maxOutputBytes: 131_072 },
      { id: 'withdraw', description: 'Withdraw one active observation recorded by this agent session. Evidence remains in task history.', inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: string(200), reason: string(1_000) } }, risk: 'write', requiresSession: true, handler: '/v2/p/findings/runtime/tools/withdraw', timeoutMs: 5_000, maxOutputBytes: 32_768 },
    ],
    contextSections: [{
      id: 'task_findings', label: 'Task findings', order: 45, read: '/v2/p/findings/runtime/context',
      defaultIncluded: true, timeoutMs: 5_000, maxBytes: 16_384, maxTokens: 1_500,
    }],
  },
}
