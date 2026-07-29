// The API rail Source: a local source (no integration row backs it), always visible — like docker.
// Saved requests aren't external items, so there is nothing to promote into a task; promotion is a
// permanent stub, which the contract requires.
import { lazy } from 'solid-js'
import type { SourceContribution } from '../../../core/client/registries/sources'

const HttpBrowse = lazy(() => import('./HttpBrowse'))

export const httpSourceContribution: SourceContribution<never> = {
  id: 'http',
  glyph: 'send',
  label: 'API',
  component: HttpBrowse,
  promotion: {
    canPromote: () => false,
    prepare: () => Promise.reject(new Error('saved requests are not promotable')),
    create: () => Promise.reject(new Error('saved requests are not promotable')),
  },
}
