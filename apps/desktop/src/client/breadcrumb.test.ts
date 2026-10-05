import { describe, expect, it } from 'vitest'
import { topbarBreadcrumb, type BreadcrumbInput } from './breadcrumb'

const input = (overrides: Partial<BreadcrumbInput>): BreadcrumbInput => ({
  task: null,
  params: { projectId: 'p1', number: '20127' },
  isNew: false,
  projectScoped: true,
  pathname: '/p/p1/github/20127',
  projectName: (id) => (id === 'p1' ? 'runn' : id),
  projectRoute: (id) => `/p/${id}`,
  ...overrides,
})

describe('topbar breadcrumb', () => {
  it('names the project and pull request under a source that reads the routed project', () => {
    expect(topbarBreadcrumb(input({}))).toEqual([{ label: 'runn', route: '/p/p1' }, { label: '#20127' }])
  })

  it('drops the routed project under a source that ignores it', () => {
    expect(topbarBreadcrumb(input({ projectScoped: false }))).toEqual([])
  })

  it('names a task by its own project, whatever the URL says', () => {
    const crumbs = topbarBreadcrumb(input({ task: { projectId: 'p2', title: 'Fix rules' }, projectScoped: false }))
    expect(crumbs).toEqual([{ label: 'p2', route: '/p/p2' }, { label: 'Fix rules' }])
  })

  it('leaves the crumb for the page you are on unlinked', () => {
    const crumbs = topbarBreadcrumb(input({ params: { projectId: 'p1' }, pathname: '/p/p1', isNew: true }))
    expect(crumbs).toEqual([{ label: 'runn' }, { label: 'new' }])
  })
})
