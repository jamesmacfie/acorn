// A stand-in for api.github.com while the shell snapshots are captured (docs/site/snapshots.md §
// The fake GitHub). The pull request scene needs a GitHub connection and a pull request, and the fixture
// can't have a real one of either. So the capture runs the app's Node behind this proxy: a request to
// api.github.com is answered here from the fixture's world and its repository, under a certificate
// the Node trusts for the capture only, and every other host is tunnelled through untouched.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TLSSocket } from 'node:tls'

const HOST = 'api.github.com'

/** A certificate for api.github.com that is its own authority, so the Node can trust it by file. */
function certificate(directory) {
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${HOST}`,
    '-addext', `subjectAltName=DNS:${HOST}`, '-addext', 'basicConstraints=critical,CA:TRUE',
    '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'),
  ])
  if (result.error?.code === 'ENOENT') throw new Error('The pull request scene needs openssl on PATH.')
  if (result.status !== 0) throw new Error(`openssl failed: ${result.stderr}`)
  return { key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) }
}

const connection = (nodes) => ({ pageInfo: { endCursor: null, hasNextPage: false }, nodes })

/** The answers, read from the world's pull request and the commits on its branch. */
function github(world, repo) {
  const { pull } = world
  const [owner, name] = new URL(world.projects[0].remote).pathname.replace(/\.git$/, '').slice(1).split('/')
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const base = git('rev-parse', 'main')
  const head = git('rev-parse', pull.branch)
  const updatedAt = '2026-10-14T16:20:00Z'
  const viewer = { login: 'ana-ruiz', name: world.author.name, avatar_url: null }
  const repository = {
    id: 40_128,
    name,
    private: true,
    default_branch: 'main',
    pushed_at: updatedAt,
    owner: { login: owner },
  }
  const files = () =>
    git('diff', '--numstat', `${base}...${head}`)
      .split('\n')
      .map((line) => {
        const [additions, deletions, filename] = line.split('\t')
        const patch = git('diff', `${base}...${head}`, '--', filename)
        return {
          filename,
          status: Number(deletions) === 0 && !git('ls-tree', base, filename) ? 'added' : 'modified',
          additions: Number(additions),
          deletions: Number(deletions),
          sha: git('rev-parse', `${head}:${filename}`),
          patch: patch.slice(patch.indexOf('@@')),
        }
      })
  const actor = (login) => ({ __typename: 'User', login })
  const at = (minutes) => new Date(Date.parse(updatedAt) - minutes * 60_000).toISOString()
  const composite = () => ({
    id: 'PR_fixture',
    number: pull.number,
    title: pull.title,
    state: 'OPEN',
    isDraft: false,
    bodyHTML: pull.body,
    headRefOid: head,
    baseRefOid: base,
    author: { login: pull.author },
    baseRefName: 'main',
    headRefName: pull.branch,
    updatedAt,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    autoMergeRequest: null,
    labels: connection([]),
    reviews: connection(
      pull.reviews.map((review, index) => ({
        id: `review-${index}`,
        author: actor(review.author),
        state: review.state,
        bodyHTML: review.body,
        submittedAt: at(30),
      })),
    ),
    reviewRequests: connection([]),
    comments: connection([]),
    commits: connection([
      {
        commit: {
          oid: head,
          messageHeadline: pull.title,
          committedDate: at(90),
          author: { name: pull.author, user: { login: pull.author } },
        },
      },
    ]),
    reviewThreads: connection(
      pull.threads.map((thread, index) => ({
        id: `thread-${index}`,
        isResolved: false,
        isOutdated: false,
        path: thread.path,
        line: thread.line,
        originalLine: thread.line,
        diffSide: 'RIGHT',
        comments: connection(
          thread.comments.map((comment, position) => ({
            id: `thread-${index}-comment-${position}`,
            databaseId: index * 100 + position + 1,
            author: actor(comment.author),
            bodyHTML: comment.body,
            createdAt: at(40 - position * 10),
          })),
        ),
      })),
    ),
    latestCommit: {
      nodes: [
        {
          commit: {
            oid: head,
            statusCheckRollup: {
              id: 'rollup-fixture',
              contexts: connection(
                pull.checks.map((check, index) => ({
                  __typename: 'CheckRun',
                  id: `check-${index}`,
                  name: check.name,
                  status: check.status,
                  conclusion: check.conclusion,
                  detailsUrl: null,
                  checkSuite: null,
                })),
              ),
            },
          },
        },
      ],
    },
  })

  const repoPath = `/repos/${owner}/${name}`
  const pullPath = `${repoPath}/pulls/${pull.number}`
  return (method, path) => {
    if (path === '/user') return viewer
    if (path.startsWith('/user/repos')) return [repository]
    if (path === repoPath) return repository
    if (path.startsWith(`${repoPath}/labels`)) return []
    if (path.startsWith(`${repoPath}/pulls?`)) {
      return [
        {
          number: pull.number,
          node_id: 'PR_fixture',
          state: 'open',
          draft: false,
          title: pull.title,
          head: { ref: pull.branch, sha: head },
          base: { ref: 'main', sha: base },
          user: { login: pull.author },
          updated_at: updatedAt,
        },
      ]
    }
    if (method === 'POST' && path === '/graphql') return { data: { repository: { pullRequest: composite() } } }
    if (path === pullPath) {
      return {
        number: pull.number,
        base: { sha: base, ref: 'main' },
        head: { sha: head, ref: pull.branch },
        updated_at: updatedAt,
        changed_files: files().length,
      }
    }
    if (path.startsWith(`${pullPath}/files`)) return path.includes('page=2') ? [] : files()
    return undefined
  }
}

/**
 * Start the proxy. `env` is what a process needs to send its GitHub requests here: Node's own proxy
 * switch, the proxy, and the certificate to trust. The fixture's repository exists only once the
 * session is seeded, so `serve` names it then. `unanswered` lists every GitHub request the fake
 * couldn't answer, which is where to look when the scene draws an error.
 */
export async function startFakeGithub(world) {
  const directory = mkdtempSync(join(tmpdir(), 'acorn-snapshots-github-'))
  const { key, cert } = certificate(directory)
  const unanswered = []
  let answer = () => undefined
  const api = createServer((request, response) => {
    const url = new URL(request.url, `https://${HOST}`)
    const path = `${url.pathname}${url.search}`
    let body
    try {
      body = answer(request.method, url.pathname === '/graphql' ? '/graphql' : path)
    } catch (error) {
      unanswered.push(`${request.method} ${path}: ${error.message}`)
    }
    if (body === undefined) unanswered.push(`${request.method} ${path}`)
    response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body ?? { message: 'Not Found' }))
  })
  const proxy = createServer().on('connect', (request, socket, head) => {
    const [host, port] = request.url.split(':')
    if (host === HOST) {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      api.emit('connection', new TLSSocket(socket, { isServer: true, key, cert }))
      return
    }
    const upstream = connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(socket).on('error', () => upstream.destroy())
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  await new Promise((listening) => proxy.listen(0, '127.0.0.1', listening))
  const url = `http://127.0.0.1:${proxy.address().port}`
  return {
    env: {
      NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: url,
      NO_PROXY: '127.0.0.1,localhost,::1',
      NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem'),
    },
    unanswered,
    serve: (repo) => {
      answer = github(world, repo)
    },
    stop: () => {
      proxy.close()
      api.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
