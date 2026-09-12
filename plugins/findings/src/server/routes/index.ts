import { Hono } from 'hono'
import type { AppEnv, PluginFetchHandler } from '@acorn/plugin-api/node'
import type { FindingsLifecycle } from '../lifecycle'
import type { FindingsLegacyMigration } from '../migration'
import type { FindingsRuntime } from '../runtime'
import { portableFetch } from './carrier'
import { findingsLifecycleRoutes } from './lifecycle'
import { findingsRecordRoutes } from './records'
import { findingsReviewRoutes } from './review'
import { findingsRuntimeRoutes } from './runtime'

export const createFindingsFetch = (
  runtime: FindingsRuntime,
  lifecycle: FindingsLifecycle,
  migration: FindingsLegacyMigration,
): PluginFetchHandler => portableFetch(
  new Hono<AppEnv>()
    .route('/', findingsRecordRoutes(runtime))
    .route('/', findingsReviewRoutes(runtime))
    .route('/', findingsLifecycleRoutes(lifecycle, migration))
    .route('/', findingsRuntimeRoutes(runtime)),
)
