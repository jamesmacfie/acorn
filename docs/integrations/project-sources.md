# Project sources

A provider can list the projects a connection offers, so core's project map can scope Linear and
Rollbar rails to a workspace or a project. This page covers the source contract and the map it feeds.
[Projects and workspaces](../workspaces-and-tasks/projects.md#external-projects) covers the map from
the workspace's side.

## Project sources

A provider declares a `projects` source on its connection contribution. Given a connection and its
unsealed credential, it lists that connection's projects as `{ id, label }`. Core serves it on
`GET /v1/core/integrations/:id/projects`, so the map asks every provider the same question.

The source is optional, and its absence is the answer: a provider with nothing to list doesn't appear
in the picker. The public descriptor's `supportsProjects` is derived from the source in two places,
the projection and the registry's descriptor check, so a provider can't advertise projects it has no
source for.

The host runs the source inside the credential's secret scope, inside the provider's request budget,
and per connection, so one connection's failure stays its own. Nothing is cached, because a stale list
could tell you a project you just made doesn't exist. The list is bounded and checked again before it's
offered: up to 500 projects, with IDs and labels up to 200 bytes each, the same bounds the mapping
write accepts. An unusable or overlong ID is dropped, not truncated into another project's ID.

An ID is opaque to core: core stores it and hands it back to the provider that offered it. A provider
that groups work more than one way can offer both kinds and tell them apart itself, as Linear does
with teams ([Linear](./linear.md#teams-and-projects)).

## The map itself

A link is a row in `workspace_external_projects`: a workspace, a connection, one of the connection's
projects, and optionally one project in that workspace. Leave the project off and every project in
the workspace follows the link. Name one, and only that project's rails do. The column stores `''`
for the whole workspace, because SQLite doesn't enforce a primary key across a nullable column.

You edit the map from the connection's page under Settings > Services, because one connection usually
serves every workspace on the machine. A workspace's page and a project's **Connections** tab draw the
same map from their side (`packages/client-core/src/features/settings/ProjectConnections.tsx`). They
list the links that reach them and add links that point only there, and every write replaces the
connection's whole map.

`GET` and `PUT /v1/core/integrations/:id/mappings` carry the map. The write replaces every row that
connection owns, across all workspaces, so a sibling connection's rows stay out of it.
`PUT /v1/core/workspaces/:id/external-projects` writes the same table from the workspace's side. A
plugin frame can't reach either route, because the connection-side write replaces a whole map, and a
frame that reached it could unfollow everything.

The map isn't a mirrored resource. That contract hands the provider the external-item store and
re-reads it after every refresh, so a project list would have had to go into `issues`, the table
behind task links, context sections, and identifier resolution.
