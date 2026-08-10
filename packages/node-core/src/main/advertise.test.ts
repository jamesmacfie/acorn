import { afterEach, describe, expect, it } from 'vitest'
import { advertisedHosts, confirmAdvertiseHost } from './advertise'

const original = process.env.ACORN_ADVERTISE_HOST
afterEach(() => {
  if (original === undefined) delete process.env.ACORN_ADVERTISE_HOST
  else process.env.ACORN_ADVERTISE_HOST = original
})

// A fake with the two DataRoot members advertise.ts touches, recording what it was told.
const fakeRoot = (advertiseHost?: string) => {
  const recorded: string[] = []
  return {
    recorded,
    get advertiseHost() {
      return advertiseHost
    },
    recordAdvertiseHost(host: string) {
      recorded.push(host)
    },
  }
}

describe('which hosts a node answers to', () => {
  it('is loopback-only until someone says otherwise', () => {
    delete process.env.ACORN_ADVERTISE_HOST
    expect(advertisedHosts(fakeRoot())).toEqual([])
    // '' is a RECORDED answer ("none"), not an unanswered one — it must not become a host.
    expect(advertisedHosts(fakeRoot(''))).toEqual([])
  })

  it('reads the recorded answer, and splits the hostname-and-IP case', () => {
    delete process.env.ACORN_ADVERTISE_HOST
    expect(advertisedHosts(fakeRoot('192.168.1.50'))).toEqual(['192.168.1.50'])
    expect(advertisedHosts(fakeRoot('192.168.1.50, workshop.local '))).toEqual(['192.168.1.50', 'workshop.local'])
  })

  it('lets the environment override the recorded answer, including an answer of "none"', () => {
    process.env.ACORN_ADVERTISE_HOST = '10.0.0.4'
    expect(advertisedHosts(fakeRoot(''))).toEqual(['10.0.0.4'])
    expect(advertisedHosts(fakeRoot('192.168.1.50'))).toEqual(['10.0.0.4'])
  })
})

describe('the first-boot question', () => {
  it('does not ask when there is nobody to answer', async () => {
    delete process.env.ACORN_ADVERTISE_HOST
    // Vitest runs with no TTY, which is the same condition launchd/systemd/Docker present. Asking
    // there would block boot forever on a prompt nothing will ever read.
    const root = fakeRoot()
    await confirmAdvertiseHost(root)
    expect(root.recorded).toEqual([])
  })

  it('does not ask again once answered', async () => {
    delete process.env.ACORN_ADVERTISE_HOST
    for (const answer of ['', '192.168.1.50']) {
      const root = fakeRoot(answer)
      await confirmAdvertiseHost(root)
      expect(root.recorded).toEqual([])
    }
  })
})
