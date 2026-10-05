import { describe, expect, it } from 'vitest'
import { ApiError } from '../../infra/node/apiClient'
import { describeSourceFailure, failureFromError, type SourceFailureNames } from './sourceErrors'

const names: SourceFailureNames = {
  source: 'Release readiness', plugin: 'Northwind', provider: 'GitHub',
  input: { label: 'Pull requests', provider: 'GitHub', plural: 'Pull requests', account: 'Work' },
}
const bare: SourceFailureNames = { source: 'Release readiness' }

describe('describeSourceFailure', () => {
  it.each([
    [{ code: 'connection-required' }, names, 'Release readiness needs a GitHub account.', 'choose-account'],
    [{ code: 'connection-required' }, bare, 'Release readiness needs an account.', 'choose-account'],
    [{ code: 'input-required', input: 'pulls' }, names, 'Pull requests needs a GitHub account.', 'choose-account'],
    [{ code: 'input-required', input: 'pulls' }, bare, 'pulls needs an account.', 'choose-account'],
    [{ code: 'input-unavailable', input: 'pulls', reason: 'Not approved' }, names, 'Northwind is waiting for you to approve what it reads.', 'review'],
    [{ code: 'input-unavailable', input: 'pulls', reason: 'Account unavailable' }, names, "Pull requests can't be read. The Work account is disconnected.", 'reconnect'],
    [{ code: 'input-unavailable', input: 'pulls', reason: 'Account unavailable' }, bare, "pulls can't be read. Its account is disconnected.", 'reconnect'],
    [{ code: 'input-unavailable', input: 'pulls', reason: 'Source not installed' }, names, "Pull requests can't be read, because its source isn't installed.", undefined],
    [{ code: 'unavailable' }, { ...names, pluginOff: true }, 'Release readiness comes from Northwind, which is off.', 'turn-on'],
    [{ code: 'unavailable' }, names, "Release readiness couldn't answer.", 'retry'],
    [{ code: 'forbidden' }, names, "This account isn't available in this workspace.", 'choose-account'],
    [{ code: 'rate-limited' }, names, 'GitHub asked us to slow down. Trying again shortly.', undefined],
    [{ code: 'timeout' }, names, 'Release readiness took longer than the panel allows.', undefined],
    [{ code: 'incomplete', reason: 'invalid-records', count: 3 }, names, "Release readiness returned 3 records that didn't match what it declared.", undefined],
    [{ code: 'incomplete', reason: 'invalid-records', count: 1 }, names, "Release readiness returned 1 record that didn't match what it declared.", undefined],
    [{ code: 'incomplete', reason: 'upstream-cap', input: 'pulls' }, names, 'GitHub returned only part of the pull requests, so some items may be missing.', undefined],
    [{ code: 'incomplete', reason: 'upstream-cap' }, bare, 'Release readiness returned only part of its records, so some items may be missing.', undefined],
    [{ code: 'provider-failure' }, names, "Release readiness couldn't answer.", 'retry'],
  ])('%j', (failure, given, message, fix) => {
    expect(describeSourceFailure(failure, given)).toEqual({ message, ...(fix ? { fix } : {}) })
  })
})

describe('failureFromError', () => {
  it('reads the code and the input from a data source route error', () => {
    expect(failureFromError(new ApiError('input-required', 400, 'input-required', { details: { input: 'pulls' } }))).toEqual({ code: 'input-required', input: 'pulls' })
    expect(failureFromError(new ApiError('x', 404, 'unavailable'))).toEqual({ code: 'unavailable' })
    expect(failureFromError(new Error('boom'))).toBeUndefined()
  })
})
