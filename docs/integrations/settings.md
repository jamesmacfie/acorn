# Connection settings

This page covers the two Settings pages that list connections, a connection's own page, and how a
connection is named. The client code is in `packages/client-core/src/features/settings/connections/`.

## Settings

The **Connections** group has two pages. Each connection is on one of them, chosen by its provider's
`kind` (`connections.ts`):

- **Services**, page ID `integrations`, lists every connection whose provider isn't a `model-provider`:
  GitHub, Linear, Rollbar, the Sentry exporter, and any provider a plugin adds. Plugins and notices
  open it by that ID.
- **AI models**, page ID `ai-models`, lists the model-provider keys beside the agent CLIs this machine
  has ([model providers](./model-providers.md)). Set **Generate with** under **Agents > Harnesses
  and defaults > Generating text**. That pick belongs to this device and carries a **This device** chip.

A connection with status `needs-auth` is listed first with an amber dot. Core's attention source
`core.connectionsNeedAuth` (`connectionAttention.ts`) raises a bell row targeted at that page, which
puts the dot beside the page in the settings rail. The client refetches the row on `connection:changed`.

## A connection's page

**Manage** opens one connection's page in the same pane, with a back link. The page leads with what's
wrong and the button that fixes it: **Replace key** for typed fields, **Turn on** for a connection
that's off, **Test** for one that didn't answer. A device-flow provider such as GitHub has no key, and
the Node refuses a second connection past `maxConnections`, so its fix is to disconnect and connect
again, and the page says so. Below that are **Name**, **Credentials** (**Test** and **Replace key**),
an **On** switch, **Where it shows up** for a provider that lists projects
([the map](./project-sources.md#the-map-itself)), and **Disconnect** in the danger zone, which names
the cascade first. **Replace key** is a form with **Save** and **Cancel**.

**Add connection** opens a gallery from the public descriptors: one card per `connectable` provider,
saying what it asks for, or "Sign in with a code" for a device flow. A provider at `maxConnections`
shows as connected, and its card opens the connection. **Add a key** on AI models shows only model
providers. A card opens its form or device code on the same page. The fields, the write, and the
device-flow pacing are in `packages/client-core/src/features/integrations/credentialForm.ts` and
`deviceFlow.ts`, which onboarding shares.

Search finds a connection by name. A workspace's page and a project's **Connections** tab draw the
project map from their side, and link to each connection's page.

## Naming a connection

A connection carries two strings. `label` is the provider's answer, written by `normalize` at connect
and rewritten on every key replacement: Linear reports the workspace, Rollbar the project, GitHub the
login. `name` is what you typed in Settings, and is null until you type one.

Show a connection with `connectionName` from `packages/protocol/src/integrations/providers.ts`, which reads the
name and falls back to the label. `PATCH /v1/core/integrations/:id` renames, and `name: null` clears it.

They're separate columns for two reasons. Replacing a key rewrites `label`, which would erase a name
stored there. And Rollbar's project source reports `label` as the project's name, so renaming a
connection would rename a project in the picker.

A provider that holds several connections tells them apart where it merges their rows. Linear's rail
adds a workspace column only when more than one connection contributed rows.
