import { registerCoreDataSource } from './registry'

// The catalog is available at boot; the scheduler read loads only when the source is queried.
registerCoreDataSource(
  {
    sourceId: 'schedules',
    name: 'Schedules',
    singular: 'Schedule',
    plural: 'Schedules',
    identityScope: "Schedule key: 'core:<id>', '<pluginId>:<scheduleId>', or 'user:<uuid>'",
    titlePointer: '/name',
    icon: 'calendar-clock',
  },
  async (request, env) => (await import('./coreSchedules')).coreSchedules(request, env),
)
