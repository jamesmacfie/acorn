import { expect, it } from 'vitest'
import type { DataSourceRequest } from 'acorn-plugin-types'
import { checkStarterTriggers, testTrigger } from 'acorn-plugin-sdk/testing'
import { alerts } from './feed'
import { hostsDescription, readHosts } from './hosts'

// #region test
const alert = (id: string, load: number) => ({ id, data: { host: 'web-1', load, time: 1 } })
const host = (load: number) => ({ id: 'web-1', data: { host: 'web-1', load, time: 1 } })
const [feedStarter] = alerts.description.starterTriggers!
const [hostStarter] = hostsDescription.starterTriggers!

it('suggests triggers the Node keeps', () => {
  checkStarterTriggers(alerts.description)
  checkStarterTriggers(hostsDescription)
})

it('starts one run for each new alert above 4, and none for one it has seen', () => {
  const result = testTrigger(
    alerts.description,
    feedStarter!.change,
    [[alert('a', 6.2)], [alert('a', 6.2), alert('b', 3.1)], [alert('a', 6.2), alert('c', 5)]],
    { predicate: feedStarter!.predicate! },
  )
  expect(result.map((read) => read.starts.map((start) => start.id))).toEqual([['a'], [], ['c']])
})

it('starts a run when a host goes above 4, and again only after it drops and climbs back', () => {
  const loads = [6.2, 6.4, 5.8, 2.1, 6]
  const result = testTrigger(
    hostsDescription,
    hostStarter!.change,
    loads.map((load) => [host(load)]),
    { predicate: hostStarter!.predicate! },
  )
  expect(result.map((read) => read.starts.length)).toEqual([1, 0, 0, 0, 1])
})
// #endregion

it("reads each host's newest alert from the feed, then filters and pages", async () => {
  const event = (host: string, load: number, time: number) => ({
    ref: { recordId: `${host}:${time}` },
    data: { host, load, time },
  })
  const pages = [
    { records: [event('web-2', 1, 30), event('web-1', 6.2, 20)], completeness: { kind: 'more', cursor: 'next' } },
    { records: [event('web-1', 2, 10), event('db-1', 5, 5)], completeness: { kind: 'complete' } },
  ]
  const cursors: (string | undefined)[] = []
  const ctx = {
    dataSources: {
      invoke: async (request: { cursor?: string }) => {
        cursors.push(request.cursor)
        return pages[cursors.length - 1]
      },
    },
  } as never
  const query = (cursor?: string): Extract<DataSourceRequest, { operation: 'query' }> => ({
    operation: 'query',
    query: {
      source: { pluginId: 'acme-alerts', sourceId: 'hosts' },
      scope: { parameters: {} },
      sort: [],
      predicate: hostStarter!.predicate,
    },
    mode: 'execution',
    evaluationTime: 100,
    pageSize: 1,
    ...(cursor ? { cursor } : {}),
  })
  const first = await readHosts(
    ctx,
    query(),
    { principal: { kind: 'device', userId: 'owner' } },
    new AbortController().signal,
  )
  expect(cursors).toEqual([undefined, 'next'])
  expect(first.records).toEqual([
    { recordId: 'db-1', data: { host: 'db-1', load: 5, time: 5 }, display: { title: 'db-1' } },
  ])
  expect(first.completeness).toEqual({ kind: 'more', cursor: '1' })
  cursors.length = 0
  const last = await readHosts(
    ctx,
    query('1'),
    { principal: { kind: 'device', userId: 'owner' } },
    new AbortController().signal,
  )
  expect(last.records.map((record) => record.data)).toEqual([{ host: 'web-1', load: 6.2, time: 20 }])
  expect(last.completeness).toEqual({ kind: 'complete' })
})
