import { describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '../baseline.ts'
import { PLUGIN_API_MAJOR } from './apiVersion.ts'
import { pluginManifestShape } from './contract.ts'
import { clientDeclaration } from './declaration.ts'

const manifest = () => pluginManifestShape.parse({
  id: 'board',
  name: 'Board',
  version: '1.0.0',
  baseline: ACORN_BASELINE,
  apiVersion: PLUGIN_API_MAJOR,
})

describe('clientDeclaration', () => {
  it('gives the same consent identity to equivalent declarations in different key orders', () => {
    const offer = manifest()
    const reordered = {
      emits: offer.emits,
      contributions: offer.contributions,
      permissions: {
        node: offer.permissions.node,
        events: offer.permissions.events,
        api: offer.permissions.api,
      },
      apiVersion: offer.apiVersion,
    }

    expect(clientDeclaration(reordered)).toBe(clientDeclaration(offer))
  })

  it('changes the consent identity when an enforced grant or emitted event changes', () => {
    const offer = manifest()
    const accepted = clientDeclaration(offer)

    expect(clientDeclaration({
      ...offer,
      permissions: { ...offer.permissions, api: ['tasks:write'] },
    })).not.toBe(accepted)
    expect(clientDeclaration({
      ...offer,
      emits: [{ verb: 'changed', description: 'Board changed' }],
    })).not.toBe(accepted)
  })
})
