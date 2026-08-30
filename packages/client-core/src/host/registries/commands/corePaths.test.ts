import { describe, expect, it } from 'vitest'
import { createTaskPath, isProjectPath, projectIdFromPath, projectPath, taskPath } from './corePaths'

describe('core paths', () => {
  it('encodes ids that would otherwise change the shape of the path', () => {
    expect(projectPath('project/web')).toBe('/p/project%2Fweb')
    expect(taskPath('task 1')).toBe('/t/task%201')
    expect(createTaskPath('project-web')).toBe('/p/project-web/new')
  })

  it('recognises any project-scoped path, including one a plugin contributed', () => {
    expect(isProjectPath('/p/project-web')).toBe(true)
    expect(isProjectPath('/p/project-web/pulls/42')).toBe(true)
    expect(isProjectPath('/t/task-1')).toBe(false)
    expect(isProjectPath('/settings/projects')).toBe(false)
  })

  it('reads the project id back out, whatever the source appended', () => {
    expect(projectIdFromPath('/p/project-web')).toBe('project-web')
    expect(projectIdFromPath('/p/project%2Fweb/issues/ENG-1')).toBe('project/web')
    expect(projectIdFromPath('/t/task-1')).toBeNull()
  })
})
