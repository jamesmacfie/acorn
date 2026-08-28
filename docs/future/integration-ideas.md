# Integration ideas: what else belongs in the workspace

Status: research notes, 2026-08-21. Nothing here is planned or scheduled. This is a survey of the
tooling developers touch on a normal working day, written down so that the plugin and contribution
contracts get designed against the whole space instead of against the six integrations that happen
to exist. Read it as a pressure test for the seams in
[docs/extensibility.md](../extensibility.md) and the fat-core position in
[docs/future/ecosystem/blockers.md](./ecosystem/blockers.md), not as a roadmap.

## What already exists

The plugins under `plugins/` cover code, tickets, errors, data, and requests: **github, linear,
rollbar, database, http, docker, preview, terminal, editor, changes, notes, memory, context, agents,
model-providers, workflows, onboarding**, plus the three agent profiles. Behaviour for those lives in
[docs/first-party-plugins.md](../first-party-plugins.md) and
[docs/integrations.md](../integrations.md).

Against the survey below, three gaps stand out. Nothing in the workspace answers *what is my build
doing*, nothing answers *what is my deploy doing*, and nothing replaces the dozen browser tabs people
keep open for format-and-decode chores.

## The ten with the best ratio

Ordered by daily use divided by build cost, given the seams that already exist.

1. **Continuous integration for the current branch.** Pipeline status, the failing job, a tailed log,
   rerun. Today this forces a trip to the browser at exactly the moment a person is least patient.
   `SourceContribution` plus a dashboard row plus one `AgentToolContribution` for "why did this fail".
2. **Sentry.** The rollbar plugin already proves the error-source shape, including
   `ExternalItemStore` scoping and `tracksRef`. Sentry has an order of magnitude more users.
3. **Preview deployments.** Vercel, Netlify, Cloudflare Pages, Fly. Bind the deployment for a branch
   to the preview plugin and every worktree gets a live URL.
4. **Feature flags.** LaunchDarkly, Unleash, PostHog, Flagsmith. Read the flag list, flip one for
   your own environment, and find which flags the file under the cursor references.
5. **A developer utilities pane.** JSON, JWT, base64, hashing, UUID, timestamps, cron expressions,
   regex, diff, colour conversion. No credentials, no network, no state, and it deletes browser tabs.
6. **Kubernetes.** Pods, logs, exec, describe, events, port-forward, rollout restart, with the
   context and namespace scoped to the service in the worktree.
7. **Package and dependency status.** What is outdated, what carries an advisory, and what changed
   between two versions. Pairs with the Dependabot workflow that already has a skill.
8. **Jira.** Linear is a better product. Most teams are not on it.
9. **Stripe CLI.** Forward webhooks into a worktree's local port and inspect the events. Sits
   directly beside the http plugin.
10. **A mail catcher.** Mailpit or Mailtrap. Every application sends email and nobody wants a separate
    browser tab to read it.

## The catalogue

Shape hints use the registry names from [docs/extensibility.md](../extensibility.md):
`SourceContribution` for a rail entry with list and detail views, `PaneContribution` for something
beside the editor in a task, `CollectionContribution` for dashboard rows,
`ConnectionProviderContribution` for credentials with no UI of its own, and
`AgentToolContribution` for something the model can call.

### Continuous integration, builds, and deploys

- GitHub Actions. Watch the run for a branch, tail a failing job, rerun failed jobs.
- CircleCI, Buildkite, GitLab CI, Jenkins, TeamCity, Azure Pipelines, Drone. The same shape behind a
  different API, which argues for one pipeline contract with per-provider adapters.
- Turbo and Nx remote cache. Hit rate for the build that just ran, and why it missed.
- Vercel. Deployments per branch, build logs, promote to production, environment variables.
- Netlify, Cloudflare Pages and Workers, Fly.io, Railway, Render, Heroku, Deno Deploy. Deploy list,
  logs, rollback, secrets.
- ArgoCD and Flux. Sync status per application, drift, trigger a sync.
- Spinnaker, Harness, Octopus Deploy. Pipeline state and manual approvals.
- Release orchestration. Changesets, semantic-release, release-please. What is in the next release,
  which version bump it implies, and a draft of the notes.
- GitHub Releases and changelog watching. A new version of a dependency, with its breaking changes.
- Build artifact browser. Bundle size for this branch against main, and what grew.
- Image registries. Docker Hub, GitHub Container Registry, ECR. Tags, sizes, scan results.

### Cloud consoles

- AWS, restricted to the parts a developer opens daily: CloudWatch logs, Lambda invocations and logs,
  an S3 browser, SQS depth and message peeking, a DynamoDB item browser, ECS or Fargate task state,
  Parameter Store and Secrets Manager values, the IAM policy simulator, and cost by service.
- Google Cloud. Cloud Run revisions and logs, a Cloud Logging query, Pub/Sub subscriptions, a
  BigQuery pane, a Firestore browser, a Cloud Storage browser.
- Azure. App Service logs, Functions, Blob Storage, Application Insights queries.
- Cloudflare. DNS records, Workers logs and tail, KV and R2 and D1 browsers, cache purge, WAF events,
  tunnel status.
- Supabase. Table editor, SQL editor, auth users, storage, edge function logs. One plugin covering
  what four would.
- PlanetScale and Neon. Branch list, schema diff between branches, query insights, and a connection
  string per branch. Database branching maps onto worktrees better than anything else in this file.
- Upstash, Redis Cloud, MongoDB Atlas. Key browser, slow queries, cluster health.
- Terraform and Terragrunt. Plan output rendered as a reviewable diff, state list, drift detection,
  workspace switch.
- Pulumi. Stack outputs, preview diff, up.
- Cost. Infracost against a Terraform plan, or a single monthly-spend row from the bill.

### Kubernetes and containers

- Kubernetes. Pods, logs, exec, describe, events, port-forward, rollout restart, plus context and
  namespace switching.
- Helm. Release list, values diff, rollback.
- Kustomize. Render an overlay for an environment and diff it.
- A live namespace view in the k9s style, scoped to the service in the worktree.
- OrbStack and Colima. Container and virtual machine state, machine resource use. Adjacent to docker.
- Compose stack control. Start the dependencies for a worktree and report which ports each service
  claimed.
- Skaffold and Tilt. Local Kubernetes dev-loop status.

### Observability, errors, and logs

- Sentry. Issues scoped to a service, a source-mapped stack trace, assign, resolve, link to a task.
- Bugsnag, Honeybadger, Airbrake, Raygun. The rollbar shape again.
- Datadog. Log search, the APM service map, monitor state, an embedded dashboard, and a latency and
  error-rate row.
- Grafana. A rendered panel from a saved dashboard, a Loki query, alert rule state.
- Honeycomb. Query by trace, heatmap, BubbleUp on a slow endpoint.
- New Relic, Dynatrace, AppDynamics, Elastic APM, Splunk. A query pane plus service health rows.
- An OpenTelemetry collector with a local trace view for the requests a worktree just served. Few
  tools do this well, and the worktree scoping is the part nobody else can offer.
- Jaeger and Tempo. Trace lookup by ID, pasted from a log line.
- Axiom, Better Stack, Papertrail, Logtail, Loki. A saved query, a live tail, an error-rate row.
- Coralogix. The CLI is already wrapped by skills in this checkout.
- Prometheus. An ad hoc PromQL pane and the alert list.
- Uptime Kuma, UptimeRobot, Checkly, Pingdom. Endpoint status rows, and which check is red.
- Third-party status pages. GitHub, AWS, Stripe, npm. One row that says the outage is not yours.
- Session replay. LogRocket, FullStory, Highlight, PostHog. Jump from an error to the recording.
- Release health. Did the sourcemaps upload for this deploy, and what is the crash-free rate.

### Incidents and on-call

- PagerDuty. Who is on call, open incidents, acknowledge, escalate.
- Opsgenie, incident.io, FireHydrant, Rootly, Grafana OnCall. Incident timeline, and starting a task
  from an incident.
- Postmortem drafting. Pull the timeline, the deploys around it, and the error spike into a note.
- Status page publishing. Statuspage, Instatus. Post an update without opening a browser.

### Feature flags and configuration

- LaunchDarkly. Flag list, targeting rules, a toggle for your own user, and which flags a file
  references.
- Unleash, Flagsmith, ConfigCat, Split, Statsig, GrowthBook, PostHog flags. One contract, six
  adapters.
- Remote config and experiment state. Which bucket am I in.
- Flag hygiene as an agent tool. Flags older than 90 days that are fully rolled out and can go.

### Secrets and credentials

- 1Password. Read a secret into a worktree's environment without it reaching disk.
- Vault, Doppler, Infisical, AWS Secrets Manager, SOPS, age. Fetch, inject, rotate.
- Environment file manager. Diff `.env` against `.env.example` and name the missing variable before
  the application crashes on it.
- Secret scanning. gitleaks or trufflehog over the diff. A pre-push gate, not a pane.

### Databases and data

- Postgres, MySQL, SQLite, SQL Server, Oracle. Beyond the database plugin: schema browser, explain
  plan visualiser, index suggestions, query history, saved queries per project.
- Redis. Key browser, TTL, a pub/sub monitor, memory by key pattern.
- MongoDB. Collection browser, aggregation pipeline builder.
- Elasticsearch and OpenSearch. Index list, mapping, ad hoc query.
- ClickHouse, DuckDB, BigQuery, Snowflake. An analytical query pane against local files or a warehouse.
- Migration state for Prisma, Drizzle, and TypeORM. What is pending in this worktree, generate one,
  diff the schema against the live database.
- Seed and fixture management. Reset a worktree's database to a known state in one action.
- Kafka. Topics, consumer lag, produce a test message, peek at recent messages.
- RabbitMQ, NATS, SQS, Pub/Sub, Temporal. Queue depth, dead-letter inspection, replay.
- Airflow, Dagster, dbt. Run state per DAG or model, which task failed, rerun.
- Data diff. Compare two tables or two database branches for row counts and drift.

### APIs, webhooks, and contracts

- OpenAPI. Render the spec for the service being edited, generate a request into the http pane, and
  diff the spec against main to catch a breaking change.
- GraphQL. Schema explorer, query editor with completion, persisted queries, schema diff against
  production.
- gRPC. Reflect a service, build a call, stream responses. grpcurl behind a UI.
- Protobuf and Avro. Decode a payload pasted from a log, check schema registry compatibility.
- Collection import from Postman, Insomnia, and Bruno. Meet people where their requests live.
- ngrok, Cloudflare Tunnel, localtunnel, Tailscale Funnel. Expose a worktree port and surface the
  public URL. Pairs with preview.
- A webhook inspector. Catch inbound webhooks, replay one against a worktree, read the exact body.
- Hookdeck, Svix, Convoy. Delivery attempts and retrying a failed delivery.
- Mock servers. Mockoon, WireMock, Prism, and MSW handler generation from a spec.
- Contract testing. Pact broker state and can-I-deploy.
- HTTP archive import. Drop a `.har` from browser devtools and save one of its requests.
- API gateway configuration. Kong, Apigee, AWS API Gateway route lists.
- Quota view. How much of a third-party API budget today's test runs consumed.

### Dependencies, packages, and supply chain

- npm, PyPI, crates.io, RubyGems, Go modules, Maven. Search, versions, download counts, and what
  changed between two releases.
- Install-size check before adding a dependency.
- Dependabot and Renovate. Open update pull requests, grouped, with a risk read.
- Snyk, Socket.dev, Trivy, Grype, OSV. Advisories against this repository, with the upgrade path.
- Licence compliance. What the dependency tree just pulled in.
- Software bill of materials. Generate and diff.
- Monorepo graph. Which packages a change affects, what needs testing, what needs publishing.
- Lockfile diff reader. Turn a 4,000-line lockfile change into a list of what moved.

### Git, code review, and code intelligence

- Graphite. Stacked pull requests, restack, submit the stack.
- Gerrit, Phabricator, Reviewable, Review Board.
- GitLab and Bitbucket. Merge requests, pipelines, comments. A large share of the market the github
  plugin does not reach.
- CodeRabbit, Greptile, Codacy, SonarQube, Qodana. Review findings on the current diff.
- Sourcegraph and grep.app. Search across every repository in an organisation, not just this one.
- Blame and history explorer. Who owns this code, what changed it, which pull request, which ticket.
- Commit message helper with a preview of the release impact. The commit-smart skill covers the
  authoring half.
- Worktree manager. Every worktree, its branch, its dirty state, and its port allocations.
- Stash and patch browser.
- Merge conflict resolution as a first-class pane rather than a text file with markers.
- Code owners. Who has to approve this diff, and whether they are around.
- Coverage diff. Which lines in this pull request are uncovered.

### Issues and project management

- Jira. Issues assigned to you, transitions, work logging, and creating a task from an issue.
- GitHub Issues and Projects. Board, sprint, my issues.
- Shortcut, Height, Asana, ClickUp, Trello, Basecamp, Monday, YouTrack, Azure Boards.
- A standup assistant. What you touched yesterday across git, pull requests, and tickets, drafted as
  three bullets.
- Sprint health row. Open, in review, blocked, and what is assigned to you.
- Support tickets. Zendesk, Intercom, Front, Help Scout, Plain. The bug report that started the task.
- Customer feedback. Canny, Productboard. Why the feature exists.

### Chat, mail, and calendar

- Slack. Threads that mention you, the channel for this repository, posting a deploy note, reactions.
- Discord and Microsoft Teams. The same shape.
- Email, restricted to what a developer needs: alerts, build failures, review requests.
- Calendar. The next meeting, the time until it, and the join link. One row is enough.
- Meeting notes capture into the notes plugin.
- Focus control. Silence Slack while a task is running.

### Documentation and knowledge

- Notion. Page search, reading a page beside the code, appending to a running document.
- Confluence, Slab, Outline, Obsidian, Bear, Logseq, Roam.
- DevDocs, Dash, and Zeal. Offline API documentation for the library under the cursor.
- Mintlify, Docusaurus, GitBook, ReadMe, Starlight. Preview a docs site for a branch and find broken
  links.
- Decision records. Start one from a task, against a template.
- Internal developer portals. Backstage, Port, Cortex, OpsLevel, Roadie. Service catalogue, ownership,
  scorecard, runbook. If the workspace ever wants a "what is this service" pane, this is the source.
- Runbook runner. Markdown where each step is an executable command.
- Glossary and company-practice search, extending onboarding.
- Symbol lookup against Stack Overflow and MDN.

### Design and frontend

- Figma. The frame for the ticket being implemented, spec inspection, asset export, and a diff
  against what was built.
- Storybook. Components on this branch, one rendered beside its source, the prop table.
- Chromatic, Percy, Lost Pixel. Visual diff review for a pull request.
- Design tokens. Which token holds this colour, and whether a value is off-system.
- Icon browser for Lucide, Heroicons, and Simple Icons. Search and copy the name, which is what the
  icon resolver consumes.
- Responsive preview across several viewports, in the Polypane style. An extension of preview.
- Accessibility audit. axe or Pa11y against the preview URL, with violations as rows.
- Colour tools. Contrast ratio, palette generation, colour-vision simulation.
- Font and typography inspection.
- Fixture data generation, Faker-backed, for filling a form under test.
- Image work. Compress, convert, and clean up SVG.

### Local development environment

- Port and process manager. What holds 3000, kill it, and which worktree claimed which port. This one
  gets painful in proportion to how many worktrees a person runs.
- mise, asdf, nvm, pyenv, rbenv. Which runtime versions the repository wants, whether they are
  installed, and installing them.
- direnv. What environment this directory loads.
- Local TLS with mkcert. Trusted HTTPS for a worktree's dev server.
- Hosts file manager. Point a domain at a local port and put it back afterwards.
- Service dependency runner. Postgres, Redis, and a queue for a worktree, started and stopped together.
- Disk and cache cleaner, with the reclaimable total shown before you commit to it.
- Shell history search scoped to this repository.
- Task runner discovery across just, make, npm scripts, and mise tasks, with output in a pane.
- SSH access. Host list, connect, tail a remote log.
- File watcher status. Whether the dev server is actually recompiling.

### Testing and quality

- Test runner pane for Vitest, Jest, pytest, Go test, and RSpec. Run, filter, watch, and jump from a
  failure to the line.
- Flaky test tracker. Which tests failed intermittently this week.
- Playwright. Trace viewer, running a spec against the preview URL, recording a new one.
- Cypress and Selenium.
- Load testing. k6, Artillery, Vegeta. Run a scenario against the preview URL and chart latency.
- Mutation testing and coverage trends.
- Lint and type error aggregation across the monorepo, deduplicated and grouped by package.
- Fuzz and property test runners.

### Performance

- Lighthouse and PageSpeed against the preview deployment, with what regressed.
- Bundle analyzer. A treemap, and what grew since main.
- Flame graph viewer for a captured profile, in any language.
- Database query performance. The slow query log, the explain plan, and which endpoint caused it.
- Core Web Vitals from real users, pulled from the analytics provider.

### Utilities and converters

One pane with a searchable command list, not thirty plugins.

- JSON. Format, validate, minify, query with jq, tree view, diff, and generate TypeScript types.
- YAML, TOML, XML, CSV, and INI conversion in every direction.
- JWT decode and verify.
- Base64, URL, HTML entity, and quoted-printable encode and decode.
- Hashing. MD5, the SHA family, bcrypt, HMAC.
- Encryption playground. AES, RSA key generation, PGP.
- Identifier generation. UUID, ULID, nanoid, KSUID.
- Timestamp conversion, timezone conversion, duration arithmetic.
- Cron expression explanation with the next run times.
- Regex tester with named groups and a plain-English explanation.
- Text diff, three-way merge, and patch application.
- Case conversion, slugify, trim, sort, deduplicate, word count.
- Number base conversion, a bitwise calculator, byte size conversion.
- Colour conversion between hex, RGB, HSL, and OKLCH.
- QR code and barcode generation and reading.
- Test fixtures. Lorem, card numbers, IBAN.
- SQL formatter, and a query builder feeding the database plugin.
- Markdown preview, table formatting, and HTML to Markdown.
- Certificate decoder. Read a PEM, check expiry, check the chain.
- Unicode and emoji inspector, and an invisible character finder.
- ASCII and Mermaid diagram rendering from selected text.
- curl to code conversion, in the language of the current file.
- Semver calculator. Whether a range matches a version.
- Regex-based bulk rename with a preview across files.

### Third-party service sandboxes

- Stripe. Webhook forwarding, test events, recent test-mode payments, products and prices.
- Mailpit, Mailhog, Mailtrap, Resend, Postmark, SendGrid. Catch outgoing email, view the HTML, check
  deliverability.
- Twilio. SMS log and a test send.
- Auth providers. Auth0, Clerk, WorkOS, Okta, Firebase Auth. User list, impersonate a test user,
  decode the token in hand.
- Search providers. Algolia, Meilisearch, Typesense. Index browser, test query, reindex.
- Content management. Contentful, Sanity, Strapi, Payload. Content beside the template rendering it.
- Push notifications. Firebase Cloud Messaging and APNs test sends.
- Maps and geocoding sandbox.
- Model providers beyond the existing plugin. Token counting, cost per request, a prompt playground,
  eval runs.

### Networking and DNS

- DNS lookup. dig behind a UI, plus a propagation check across resolvers.
- Whois and domain expiry.
- TLS certificate check. Expiry, chain, protocol support.
- HTTP header inspector and redirect chain follower.
- IP and geolocation lookup, CIDR calculator, subnet planner.
- Port scan and connectivity check against a host under investigation.
- Packet capture summary. What talked to what, not a full protocol analyser.
- CORS and CSP debugger. Why the browser is blocking this request.

### AI and agent tooling

- Usage and cost dashboard. Tokens and spend per provider per day across Claude, Codex, and Copilot.
  The account-level read model exists; the spend view is the missing half.
- Prompt and eval workbench. Version a prompt, run it over a fixture set, diff the outputs.
- MCP server manager. Which servers are connected, their tools, their health, and a test call. See
  [docs/mcp.md](../mcp.md).
- Agent run history with per-hunk accept and reject.
- Context budget inspector. What is in the model's context for this task and what is consuming it.
- Local model runner. Ollama or LM Studio model list, load, unload, memory use.
- Vector store browser. Pinecone, Qdrant, Weaviate, pgvector. Search, inspect embeddings, check a
  retrieval result.

### Analytics and product

- PostHog. Event stream, funnels, flags, replays. One plugin covering four categories.
- Amplitude, Mixpanel, Heap. Event volume, and whether a new event is arriving.
- Plausible, Fathom, Umami, Google Analytics. A traffic row.
- Event schema validation. Whether the event just fired matches the tracking plan.
- Revenue rows. Stripe monthly recurring revenue, signups today. Sometimes the fastest outage
  detector available.

### Personal and workflow

- Time tracking. Toggl, Harvest, Clockify. Start a timer when a task opens.
- A focus timer tied to task state.
- Scratchpad and clipboard history.
- A per-repository link store.
- Screenshot and screen recording with annotation, for pull request descriptions and bug reports.
- Snippet library over gists and local snippets, insertable into the editor.
- Reading queue for articles and videos, read in a pane.
- Keyboard shortcut cheat sheet for the tools in the workspace.

## What these want from other plugins

Added 2026-08-28. Almost every entry above is a plugin's own surface: a rail source, a pane, a
collection, a tool. What the entries want from *other* plugins is narrower and recurs: attach a fact
to an item somebody else draws (coverage on a diff line, a flag on an editor line, CI on a PR, a pod
on a container), or act before something happens (scan before push, inject secrets before a run
target starts, gate a workflow step). Those are the **annotation** and **hook** kinds in
[docs/future/layout/03-extension-kinds.md](./layout/03-extension-kinds.md), and they exist because
this catalogue kept asking for them. Very few entries need a box inside another plugin's pane.

## Four shapes, not two hundred plugins

Most of the catalogue collapses into four repeated shapes, which puts the leverage in the contracts
rather than in any individual plugin.

**A list of remote things with a status.** Build runs, deployments, incidents, issues, errors, queue
messages, pods, flags. One list-and-detail source contract carrying a status enum and a
branch-or-task binding covers dozens of providers. `SourceContribution`, `tracksRef`, and
`CollectionContribution` already do most of this; see
[docs/dashboards.md](../dashboards.md).

**A query pane against a remote engine.** SQL, PromQL, log search, GraphQL, DataPrime, BigQuery. An
editor, a run action, a tabular or timeline result, and saved queries scoped per project. The
database and http plugins are two instances of one thing, and the database plugin's task scoping
problem is the shared problem.

**A local process with structured output.** Test runners, task runners, log tails, port-forwards,
tunnels. A managed-process contract with a parsed output view stops each plugin from reinventing a
terminal.

**A stateless converter.** The whole utilities section. No credentials, no network, no persistence.
The cheapest category to ship and the one people notice most, because it removes browser tabs.

## Two cautions

**Combined capability, not individual capability, is the risk.** Every credentialed integration
widens the secret-exfiltration surface, and repository configuration writes are already recorded as a
code-execution path. A plugin that reads a secret manager is fine. A plugin that runs shell commands
is fine. The same trust grant covering both is not. Keep this list beside
[docs/security.md](../security.md) when the permission model is next revised.

**This catalogue is the fat-core pressure test.** The tempting move is to put the pipeline contract,
the flag contract, and the queue contract in core, because every provider needs them.
[docs/future/ecosystem/blockers.md](./ecosystem/blockers.md) already takes a position on that. The
question this file asks is whether that position survives contact with 15 continuous integration
providers who all want the same five fields.

## What to leave out

Anything whose daily use is one glance at a number. Uptime percentages, follower counts, generic
weather. Those belong in a dashboard row, not a plugin.

Anything where the vendor's own interface is the product and the API is an afterthought. Figma
comment threads and Jira board dragging are the usual examples. The result is 20% of a worse client,
and the browser tab stays open anyway.
