import { describe, expect, it } from 'vitest'
import { latestOnly } from './latestOnly'

describe('latestOnly', () => {
  it('commits only the newest invocation when requests resolve out of order', async () => {
    const resolvers: Array<(value: number) => void> = []
    const committed: number[] = []
    const refresh = latestOnly(
      () => new Promise<number>((resolve) => resolvers.push(resolve)),
      (value) => committed.push(value),
    )

    const first = refresh()
    const second = refresh()
    resolvers[1](2)
    await second
    resolvers[0](1)
    await first

    expect(committed).toEqual([2])
  })
})
