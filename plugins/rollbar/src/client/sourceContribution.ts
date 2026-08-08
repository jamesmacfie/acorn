// The Rollbar rail Source: browse a project's items, and promote one into a task.
//
// Gated by `providerId` like linear's — visible only with a connected Rollbar integration that can
// browse.
import { lazy } from 'solid-js'
import type { RollbarItemSummary } from '../shared/api'
import { prepareRollbarPromotion } from './promotion'
import { addTaskLink, createTask, type SourceContribution } from '@acorn/plugin-api/client'

const RollbarBrowse = lazy(() => import('./RollbarBrowse'))

export const rollbarSourceContribution: SourceContribution<RollbarItemSummary> = {
  id: 'rollbar',
  // Rail position, declared (registries/sources.ts § order). Was implied by this plugin's place in
  // apps/desktop/src/app/client/plugins.ts.
  order: 30,
  providerId: 'rollbar',
  glyph: '◍',
  label: 'Rollbar',
  component: RollbarBrowse,
  defaultPane: 'rollbar',
  requiredCapability: 'browse',
  promotion: {
    // Stricter than linear's: a Rollbar item has no branch of its own, so one has to be typed or
    // derived, and the modal cannot proceed on an empty string.
    canPromote: (_item, context) => !!context.projectId && !!context.branch?.trim(),
    prepare: prepareRollbarPromotion,
    create: createTask,
    attachToCurrentTask: (taskId, item) =>
      addTaskLink(taskId, {
        connectionId: item.integrationId,
        identifier: item.identifier,
        // Retain the canonical system id so detail fetches skip counter resolution.
        ref: { displayId: item.identifier, ...(item.itemId ? { externalId: item.itemId } : {}) },
      }).then(() => undefined),
  },
}
