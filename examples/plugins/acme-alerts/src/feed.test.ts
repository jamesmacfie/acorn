import { expect, it } from 'vitest'
import { checkStarterTriggers, testTrigger } from 'acorn-plugin-sdk/testing'
import { alerts } from './feed'

// #region test
const alert = (id: string, load: number) => ({ id, data: { host: 'web-1', load, time: 1 } })
const [starter] = alerts.description.starterTriggers!

it('suggests a trigger the Node keeps', () => {
  checkStarterTriggers(alerts.description)
})

it('starts one run for each new alert above 4, and none for one it has seen', () => {
  const result = testTrigger(
    alerts.description,
    starter!.change,
    [[alert('a', 6.2)], [alert('a', 6.2), alert('b', 3.1)], [alert('a', 6.2), alert('c', 5)]],
    { predicate: starter!.predicate! },
  )
  expect(result.map((read) => read.starts.map((start) => start.id))).toEqual([['a'], [], ['c']])
})
// #endregion
