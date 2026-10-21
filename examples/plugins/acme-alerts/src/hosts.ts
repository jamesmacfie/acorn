import type {
  DataPredicate,
  DataSourceDescription,
  DataSourcePage,
  DataSourceRegistration,
  DataSourceRequest,
  NodePluginContext,
  PluginRequestContext,
} from 'acorn-plugin-types'

// #region hosts
// One record per host with its latest load, built from the feed's events on each read. An alert is
// something that happened, so every alert above 4 is new. A host is current state, so "starts
// matching" fires when its load crosses 4, stays quiet while it's high, and fires again after it drops
// and climbs back.
export const hostsSource: DataSourceRegistration = {
  sourceId: 'hosts',
  name: 'Host load',
  singular: 'Host',
  plural: 'Hosts',
  identityScope: 'A host name.',
  handler: '/v1/p/acme-alerts/sources/hosts',
  titlePointer: '/host',
}

export const hostsDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { host: { type: 'string' }, load: { type: 'number' }, time: { type: 'number' } },
    required: ['host', 'load', 'time'],
  },
  fields: [
    { pointer: '/host', label: 'Host', origin: 'declared', display: { kind: 'text', role: 'title' } },
    {
      pointer: '/load',
      label: 'Load',
      origin: 'declared',
      display: { kind: 'number' },
      // The filters `readHosts` applies itself. Acorn sends only these.
      query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: false },
    },
    { pointer: '/time', label: 'Last alert', origin: 'declared', display: { kind: 'datetime', role: 'updated' } },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  consistency: 'Each host’s newest alert in the Load alerts feed. A host whose alerts have all aged out isn’t listed.',
  starterTriggers: [
    {
      id: 'high-load',
      label: 'A host’s load goes above 4',
      description: 'Starts a run when a host’s load goes above 4, and again after it drops and climbs back.',
      predicate: {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/load' } },
        operator: 'gt',
        right: { address: { from: 'literal', value: 4 } },
      },
      change: { on: 'enters' },
    },
  ],
}
// #endregion

type Query = Extract<DataSourceRequest, { operation: 'query' }>
type Host = { host: string; load: number; time: number }

const compare = {
  gt: (load: number, value: number) => load > value,
  gte: (load: number, value: number) => load >= value,
  lt: (load: number, value: number) => load < value,
  lte: (load: number, value: number) => load <= value,
}
/** The load tests in a predicate. Acorn checked it against the description, so it holds only `load`
 *  comparisons, alone or in an `all` group. */
const loadTests = (predicate?: DataPredicate): ((load: number) => boolean)[] =>
  (!predicate ? [] : predicate.kind === 'comparison' ? [predicate] : predicate.predicates).flatMap((test) => {
    if (test.kind !== 'comparison' || test.right?.address.from !== 'literal') return []
    const check = compare[test.operator as keyof typeof compare]
    const value = test.right.address.value as number
    return [(load: number) => check(load, value)]
  })

/** Answers a `query`: reads every alert, keeps each host's newest, filters, and pages by offset. */
export async function readHosts(
  ctx: Pick<NodePluginContext, 'dataSources'>,
  request: Query,
  context: Pick<PluginRequestContext, 'principal'>,
  signal: AbortSignal,
): Promise<DataSourcePage> {
  const latest = new Map<string, Host>()
  let cursor: string | undefined
  do {
    const page = await ctx.dataSources.invoke(
      {
        operation: 'query',
        query: { source: { pluginId: 'acme-alerts', sourceId: 'alerts' }, scope: request.query.scope, sort: [] },
        mode: request.mode,
        evaluationTime: request.evaluationTime,
        pageSize: 100,
        ...(cursor ? { cursor } : {}),
      },
      { principal: context.principal, signal },
    )
    for (const record of page.records) {
      const alert = record.data as Host
      if ((latest.get(alert.host)?.time ?? -Infinity) < alert.time) latest.set(alert.host, alert)
    }
    // A cut read can't say which hosts are below the line, so it answers no hosts and says why.
    if (page.completeness.kind !== 'more' && page.completeness.kind !== 'complete')
      return { records: [], revision: hostsDescription.revision, readTime: Date.now(), completeness: page.completeness }
    cursor = page.completeness.kind === 'more' ? page.completeness.cursor : undefined
  } while (cursor)

  const tests = loadTests(request.query.predicate)
  const hosts = [...latest.values()]
    .filter((host) => tests.every((test) => test(host.load)))
    .sort((a, b) => a.host.localeCompare(b.host))
  const from = Number(request.cursor ?? 0)
  const next = from + request.pageSize
  return {
    // The title names a trigger's match, and fills a workflow's `issue` input.
    records: hosts
      .slice(from, next)
      .map(({ host, load, time }) => ({ recordId: host, data: { host, load, time }, display: { title: host } })),
    revision: hostsDescription.revision,
    readTime: Date.now(),
    completeness: next < hosts.length ? { kind: 'more', cursor: String(next) } : { kind: 'complete' },
  }
}
