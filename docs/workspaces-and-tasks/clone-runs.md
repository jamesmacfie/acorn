# Clone a Git URL

The Node can clone a Git URL into a folder on its own machine and add the folder as a project. Only
the CLI's `project clone` starts one today. Plugins call `core.projects.clone` with the
`projects:write` grant.

A clone runs in the background, because a large repository takes longer than one request may. Like
[archive in the background](./background-archive.md), `POST /v1/core/projects/clone-runs` takes
`{ url, parentDir, name?, workspaceId? }` and answers 202 with `{ cloneId, state: 'running' }`.
`GET /v1/core/projects/clone-runs/:id?waitMs=20000` holds for up to 20 seconds and answers
`{ state: 'running', elapsedMs }`, `{ state: 'finished', result }`, or `{ state: 'none' }`. `result` is
`{ ok: true, projectId }` or `{ ok: false, error }`. The Node keeps a finished answer for 10 minutes,
and a restart loses every run. Both routes accept only a device token, so an agent with a task token
can't fetch code onto the Node. `cloneOutcome` in `@acorn/protocol/api.ts` is the client side. A
project this route clones starts [untrusted](./projects.md#untrusted-projects). A plugin's
`core.projects.clone` and the importers that use it write a trusted project.

The URL is untrusted input. The Node accepts `https://host/path`, `ssh://[user@]host[:port]/path`, and
`user@host:path`. It refuses every other scheme, including `http`, `file`, `git`, and `ext::`, a
password or token in the URL, a user, host, or path that starts with `-`, and any whitespace or
control character. A bare user name such as `git@` is fine. Git saves the URL in the clone's
`.git/config`, which is why a password is refused. Private repositories use the Node machine's own Git
login: a credential helper for HTTPS, or its SSH agent.

The folder is `<parentDir>/<name>`. `name` defaults to the URL's last path segment without `.git`.
The Node refuses a target that exists and isn't an empty folder before Git runs. It clones into a
hidden sibling, `.<name>.acorn-clone-<cloneId>`, with `--no-recurse-submodules`,
`GIT_ALLOW_PROTOCOL=https:ssh`, and `GIT_LFS_SKIP_SMUDGE=1`, then renames it into place. A failed clone
deletes the hidden folder, so the target never holds half a clone. If the project can't be added after
the rename, the folder stays and the error says so. A clone has 30 minutes. At most three run at once
and the rest wait. Stopping the Node stops them, and a Node that dies mid-clone leaves its hidden
folder behind.

The project row is created as `project add` creates one, with the same workspace rules and
invalidations. A plugin can instead give the clone to a project with no folder yet with
`fillProjectId`, and write a provider's ID with `fields`.
