# Acme load alerts

An acorn plugin whose only job is to notice things. It declares an event feed, **Load alerts**, and a
command that appends to it, so a script, a git hook, or a CI job on the same machine can fire a
trigger. Its source suggests one trigger: **A host’s load goes above 4**.

```text
acorn-plugin.json      the manifest: the feed, the raise command, and the suggested trigger
src/feed.ts            the feed's fields and its suggested trigger
src/index.ts           the node half: the raise command's route appends to the feed
src/feed.test.ts       testTrigger over three reads, and checkStarterTriggers
scripts/manifest.mjs   rewrites the manifest's feed entry from src/feed.ts on each build
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
