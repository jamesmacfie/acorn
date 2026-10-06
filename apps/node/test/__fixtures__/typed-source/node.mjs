import fixture from './schema.json' with { type: 'json' }

export const descriptor = {
  sourceId: 'records', name: 'Nested records', singular: 'Record', plural: 'Records',
  identityScope: 'Record ID is stable within this source.',
}

// Portable fetch handler: no Acorn internals, credentials, or UI callbacks.
export async function fetchSource(request) {
  const input = await request.json()
  const scope = input.operation === 'query' ? input.query.scope : input.scope
  const mode = scope?.parameters?.mode
  if (mode === 'error') return new Response('Unavailable', { status: 503 })
  if (mode === 'reason') return Response.json({ error: 'archived', reason: 'The project was archived.', body: 'provider text' }, { status: 502 })
  if (mode === 'timeout') return new Promise(() => {})
  if (input.operation === 'discover') return Response.json({ sources: [{ ...descriptor, sourceId: 'discovered' }], exhausted: true })
  if (input.operation === 'describe') return Response.json({
    schema: fixture.schema, fields: fixture.fields,
    parameters: { type: 'object', properties: { project: { type: 'string' }, mode: { type: 'string' } }, additionalProperties: false },
    parameterFields: [{ pointer: '/project', label: 'Project', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } }],
    operations: { query: true, options: true, details: true, incremental: true, groups: ['all', 'any'] },
    incremental: { semantics: 'Baseline enumerates the fixture snapshot at token 2. Continuation 2 returns record 3; continuation 3 is empty. Deletes are omitted, late visibility is included in the next token, and unknown or expired tokens fail. Commit only the boundary on the exhausted final page.' },
    detailSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'], additionalProperties: false },
    revision: '1', consistency: 'Live reads; no upstream snapshot isolation.',
  })
  if (input.operation === 'options') return Response.json({ options: [{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }], exhausted: true })
  if (input.operation === 'details') return Response.json(input.ref.recordId === 'missing'
    ? { kind: 'not-found' } : { kind: 'found', data: { body: 'Nested record details' }, fetchedTime: 1 })
  if (input.query.incremental?.kind === 'continue') {
    const token = input.query.incremental.boundary
    if (token !== '2' && token !== '3') return new Response('Expired boundary; choose an explicit baseline', { status: 410 })
    return Response.json({ records: token === '2' ? [{ recordId: 'sample-3', data: { ...fixture.record, state: 'open' } }] : [],
      revision: '1', readTime: 2, completeness: { kind: 'complete' }, incrementalBoundary: '3' })
  }
  const record = { recordId: input.cursor ? 'sample-2' : 'sample-1', data: { ...fixture.record, state: 'open' } }
  if (mode === 'oversize') record.data.title = 'x'.repeat(300_000)
  if (mode === 'forged') record.ref = { pluginId: 'stranger', sourceId: 'records', recordId: 'x' }
  if (mode === 'malformed') record.data.labels = 'wrong'
  if (mode === 'duplicate') record.recordId = 'sample-1'
  return Response.json({
    records: [record], revision: '1', readTime: 1,
    completeness: mode === 'incomplete' ? { kind: 'incomplete', cause: 'upstream-cap' }
      : mode === 'loop' || !input.cursor ? { kind: 'more', cursor: 'next' } : { kind: 'complete' },
    ...(input.query.incremental && input.mode === 'execution' && input.cursor && !['incomplete', 'loop'].includes(mode) ? { incrementalBoundary: '2' } : {}),
  })
}

export default { name: 'typed-source', init(ctx) { ctx.routes.fetch(fetchSource, { prefix: '/source' }) } }
