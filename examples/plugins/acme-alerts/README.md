# Acme load alerts

An acorn plugin whose only job is to notice things. It declares an event feed, **Load alerts**, and a
command that appends to it, so a script, a git hook, or a CI job on the same machine can fire a
trigger. Beside the feed it serves **Host load**, one record per host with its newest alert's load.

The two sources suggest different triggers. The feed suggests **A high-load alert arrives**, which
starts a run for every alert above 4. **Host load** suggests **A host’s load goes above 4**, which
starts a run when a host crosses 4, stays quiet while it's high, and starts again after it drops and
climbs back.

```text
acorn-plugin.json      the manifest: both sources, their suggested triggers, and the raise command
src/feed.ts            the feed's fields and its suggested trigger
src/hosts.ts           the Host load source: each host's newest alert, read from the feed
src/index.ts           the node half: the raise route appends to the feed, the hosts route reads it
src/feed.test.ts       testTrigger over both sources, checkStarterTriggers, and the hosts read
scripts/manifest.mjs   rewrites the manifest's source entries from the build
```

## Build and test

```sh
npm install
npm test
npm run build
```

## Install it and raise an alert

**Settings › Plugins › Install… › Local folder**, with this directory. Then add a trigger to a
workflow and pick **A host’s load goes above 4**. To raise an alert:

```sh
NODE_ID="$(acorn node info --output json | jq -r .nodeId)"
jq -n --arg nodeId "$NODE_ID" '{nodeId: $nodeId, host: "web-1", load: 6.2}' |
  acorn plugin acme-alerts raise --input-file -
```

Pass an `id` to make a retry safe: raising the same id twice stores one alert and starts one run.

The full guide is `docs/plugin-authoring/triggers.md` in the acorn repository.
