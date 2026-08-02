import { describe, expect, it } from 'vitest'
import { remoteMatches } from './repoPaths'

// Sample `git remote -v` output lines for github.com/acme/widget.
const ssh = 'origin\tgit@github.com:acme/widget.git (fetch)\norigin\tgit@github.com:acme/widget.git (push)'
const https = 'origin\thttps://github.com/acme/widget (fetch)\norigin\thttps://github.com/acme/widget (push)'

describe('remoteMatches', () => {
  it('matches ssh and https forms, with or without .git', () => {
    expect(remoteMatches(ssh, 'acme', 'widget')).toBe(true)
    expect(remoteMatches(https, 'acme', 'widget')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(remoteMatches(ssh, 'ACME', 'Widget')).toBe(true)
  })

  it('does not match a different repo or a prefix of one', () => {
    expect(remoteMatches(ssh, 'acme', 'gadget')).toBe(false)
    expect(remoteMatches('origin\tgit@github.com:acme/widget-2.git (fetch)', 'acme', 'widget')).toBe(false)
    expect(remoteMatches('origin\tgit@gitlab.com:acme/widget.git (fetch)', 'acme', 'widget')).toBe(false)
  })
})
