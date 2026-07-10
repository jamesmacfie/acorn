import { QueryClient } from '@tanstack/solid-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ savePref: vi.fn() }))
vi.mock('../../../core/client/settings/savePref', () => ({ savePref: mocks.savePref }))

import { saveOnboardingCompletion } from './onboardingCompletion'

describe('onboarding completion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('closes only after the onboarding preference is durable', async () => {
    const onSaved = vi.fn()
    mocks.savePref.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(saveOnboardingCompletion(new QueryClient(), onSaved)).resolves.toBe(false)
    expect(onSaved).not.toHaveBeenCalled()

    await expect(saveOnboardingCompletion(new QueryClient(), onSaved)).resolves.toBe(true)
    expect(onSaved).toHaveBeenCalledOnce()
  })
})
