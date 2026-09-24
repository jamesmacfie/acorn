import { Hono } from 'hono'
import type { AppEnv, PluginFetchHandler } from '@acorn/plugin-api/node'
import type { FindingsLifecycle } from '../lifecycle'
import type { FindingsRuntime } from '../runtime'
import { portableFetch } from './carrier'
import { findingsLifecycleRoutes } from './lifecycle'
import { findingsRecordRoutes } from './records'
import { findingsReviewRoutes } from './review'
import { findingsRuntimeRoutes } from './runtime'

export const createFindingsFetch = (
  runtime: FindingsRuntime,
  lifecycle: FindingsLifecycle,
  exportData: () => unknown,
): PluginFetchHandler => portableFetch(
  new Hono<AppEnv>()
    .route('/', findingsRecordRoutes(runtime))
    .route('/', findingsReviewRoutes(runtime, lifecycle))
    .route('/', findingsLifecycleRoutes(lifecycle, exportData))
    .route('/', findingsRuntimeRoutes(runtime)),
)
