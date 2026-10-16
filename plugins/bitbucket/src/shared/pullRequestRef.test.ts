import { expect, it } from 'vitest'
import { formatPullRequestRef, parsePullRequestRef, parsePullRequestUrl } from './pullRequestRef'

it('spells a pull request by its repository and number, and reads it back', () => {
  expect(formatPullRequestRef('acme/api', 12)).toBe('acme/api#12')
  expect(parsePullRequestRef('acme/api#12')).toEqual({ repository: 'acme/api', number: '12' })
  expect(parsePullRequestRef('gitlab.com/group/api!12')).toBeNull()
  expect(parsePullRequestRef('acme#12')).toBeNull()
})

it('reads a pull request page on bitbucket.org, with or without a tab', () => {
  expect(parsePullRequestUrl('https://bitbucket.org/acme/api/pull-requests/12')).toEqual({
    repository: 'acme/api',
    number: '12',
  })
  expect(parsePullRequestUrl('https://bitbucket.org/acme/api/pull-requests/12/diff#chg-src/app.ts')).toEqual({
    repository: 'acme/api',
    number: '12',
  })
  expect(parsePullRequestUrl('https://bitbucket.org/acme/api/pull-requests/new')).toBeNull()
  expect(parsePullRequestUrl('https://bitbucket.org/acme/api/issues/12')).toBeNull()
  expect(parsePullRequestUrl('https://github.com/acme/api/pull/12')).toBeNull()
})
