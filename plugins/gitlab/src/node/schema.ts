import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// The mirror: cached projections of gitlab.com data, revalidated and disposable. Every table is scoped
// by the owner, because two people's connections see different private projects.
//
// A merge request's child rows are replaced together on each refresh, and `sync_state` says when.
// Each child table has a `position`, its place in the order GitLab returned it, and reads order by it.

export const projects = sqliteTable(
  'projects',
  {
    userId: text('user_id').notNull(),
    id: integer('id').notNull(), // GitLab's project id
    path: text('path').notNull(), // path_with_namespace in GitLab's spelling, such as `group/sub/api`
    name: text('name').notNull(),
    defaultBranch: text('default_branch'),
    private: integer('private', { mode: 'boolean' }).notNull().default(false),
    lastActivityAt: integer('last_activity_at'), // epoch ms, the importer's order
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
)

export const mergeRequests = sqliteTable(
  'merge_requests',
  {
    userId: text('user_id').notNull(),
    projectId: integer('project_id').notNull(),
    iid: integer('iid').notNull(),
    state: text('state').notNull(), // open | closed | merged
    draft: integer('draft', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull(),
    body: text('body'), // descriptionHtml, links made absolute; the client sanitizes it
    headRef: text('head_ref'),
    baseRef: text('base_ref'),
    // diff_refs. A new diff note needs all three.
    headSha: text('head_sha'),
    baseSha: text('base_sha'),
    startSha: text('start_sha'),
    author: text('author'),
    authorAvatar: text('author_avatar'),
    updatedAt: integer('updated_at'),
    conflicting: integer('conflicting', { mode: 'boolean' }).notNull().default(false),
    // The head pipeline's status, for the list's checks dot before the detail is read.
    pipelineStatus: text('pipeline_status'),
    // The file list stopped at the mirror's page budget, so GitLab may hold more.
    filesCapped: integer('files_capped', { mode: 'boolean' }).notNull().default(false),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId, t.iid] }),
    index('merge_requests_user_project_state_updated_idx').on(t.userId, t.projectId, t.state, t.updatedAt),
  ],
)

export const mrFiles = sqliteTable(
  'mr_files',
  {
    userId: text('user_id').notNull(),
    projectId: integer('project_id').notNull(),
    iid: integer('iid').notNull(),
    path: text('path').notNull(),
    status: text('status'), // added | modified | removed | renamed
    additions: integer('additions'),
    deletions: integer('deletions'),
    position: integer('position').notNull(),
    // 'available': patch_key names the patch body in the blob cache. 'unavailable': GitLab sent no
    // diff (binary, too large, a pure rename).
    patchState: text('patch_state').notNull(),
    patchKey: text('patch_key'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId, t.iid, t.path] })],
)

// People on a merge request: its approvers and the reviewers asked. One table, told apart by `role`.
export const mrPeople = sqliteTable(
  'mr_people',
  {
    userId: text('user_id').notNull(),
    projectId: integer('project_id').notNull(),
    iid: integer('iid').notNull(),
    role: text('role').notNull(), // approver | reviewer
    login: text('login').notNull(),
    avatarUrl: text('avatar_url'),
    // When an approver approved, from the system note GitLab writes. An approval itself carries no time.
    at: integer('at'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId, t.iid, t.role, t.login] })],
)

export const mrLabels = sqliteTable(
  'mr_labels',
  {
    userId: text('user_id').notNull(),
    projectId: integer('project_id').notNull(),
    iid: integer('iid').notNull(),
    name: text('name').notNull(),
    color: text('color'), // `#rrggbb`, as GitLab sends it
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId, t.iid, t.name] })],
)

// Every note that isn't a system note. A note on the diff carries its discussion's position: GitLab
// replies go to the discussion id, and the diff addresses a thread by its first note's id.
export const notes = sqliteTable(
  'notes',
  {
    userId: text('user_id').notNull(),
    projectId: integer('project_id').notNull(),
    iid: integer('iid').notNull(),
    id: integer('id').notNull(), // the note's numeric id
    discussionId: text('discussion_id').notNull(),
    onDiff: integer('on_diff', { mode: 'boolean' }).notNull().default(false),
    path: text('path'),
    line: integer('line'),
    side: text('side'), // old | new
    // Written against an older head than the merge request's.
    outdated: integer('outdated', { mode: 'boolean' }).notNull().default(false),
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    author: text('author'),
    authorAvatar: text('author_avatar'),
    authorIsBot: integer('author_is_bot', { mode: 'boolean' }).notNull().default(false),
    body: text('body'), // bodyHtml, links made absolute
    createdAt: integer('created_at'),
    position: integer('position').notNull(), // discussions in order, then each one's notes in theirs
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId, t.iid, t.id] })],
)

export const mrCommits = sqliteTable(
  'mr_commits',
  {
    userId: text('user_id').notNull(),
    projectId: integer('project_id').notNull(),
    iid: integer('iid').notNull(),
    sha: text('sha').notNull(),
    message: text('message').notNull(),
    author: text('author'),
    authorLogin: text('author_login'),
    committedAt: integer('committed_at'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId, t.iid, t.sha] })],
)

// The head pipeline's jobs, the merge request's checks.
export const jobs = sqliteTable(
  'jobs',
  {
    userId: text('user_id').notNull(),
    projectId: integer('project_id').notNull(),
    iid: integer('iid').notNull(),
    jobId: integer('job_id').notNull(),
    name: text('name').notNull(),
    stage: text('stage'),
    status: text('status'), // GitLab's own job status, such as `failed` or `running`
    url: text('url'),
    pipelineSha: text('pipeline_sha'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId, t.iid, t.jobId] })],
)

export const syncState = sqliteTable(
  'sync_state',
  {
    userId: text('user_id').notNull(),
    resource: text('resource').notNull(),
    // A files resource's `<base sha>:<head sha>`, which its diff is cut against.
    revision: text('revision'),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resource] })],
)
