# What the site won't build or say

Date: October 15, 2026. Part of [the website programme](./README.md).

This page collects the site's refusals, so a later session argues with the reason instead of with
silence. Some carry over from the August 2026 notes, and some are from this plan. Each says what would
change the answer.

## Things the site won't build

**No server.** The output is static files. There are no accounts, no forms, and nothing to store. A
server becomes worth having when there's a live plugin registry, and
[the ecosystem plan](../ecosystem/blockers.md) puts that behind signing and package verification.

**No plugin registry or browse-and-install list.** `/plugins` lists the plugins acorn ships. A list of
third-party plugins would imply a review acorn doesn't do. If discovery ever exists, it's unreviewed and
says so, the way herdr's does.

**No screenshots of the UI where a specimen or snapshot can do the job.** A PNG goes stale silently. The
exceptions are things the kit can't draw: the macOS install dialog, a browser's extension permission
prompt, and the social card images.

**No video on the landing page.** A video costs megabytes and goes stale with every UI change. A shell
snapshot is text and CSS, and a maintainer recaptures it in minutes.

**No docs versioning.** There's one version of acorn. Plan the seam the way herdr does, with a
`versions/<v>/` folder of frozen pages and a manifest, and build none of it until `PLUGIN_API_MAJOR`
moves after launch and a plugin author needs the old pages.

**No translations.** Starlight supports them, and acorn has no second-language audience.

**No blog at launch.** An empty blog reads as an abandoned one. The changelog carries release news. Add
a blog when there's a first post worth writing.

**No comparison pages.** A page that names another product has to stay accurate about that product,
and nobody here maintains that. The FAQ answers "how is this different from X" in prose, without
naming a competitor's features.

**No email capture.** It needs a server or a third party, and there's nothing to send.

**No third-party scripts.** No embedded videos, chat widgets, font services, or tag managers. The site
loads from one origin.

**No separate repository.** The site reads the plugin contract, the kit, and the stylesheets from
source. A separate repository turns each into a publish step.

**No Starlight default look.** Starlight's header, sidebar, search box, and footer are replaced by
acorn's own components in phase 6. A docs site that looks like every other Starlight site tells the
reader nothing about the product.

## Things the site won't say

**Nothing its internal docs don't say.** A public page explains what an internal doc states. When they
disagree, the internal doc wins and the public page is wrong ([sync](./sync.md)).

**"Open source", until the repository's `LICENSE` file is committed.** The license is MIT
([owner decision 1](./README.md#what-the-owner-decides)), and [phase 8](./08-landing.md) adds the file.

**Anything about unshipped work.** No roadmap, no "coming soon", no "not yet". Proposals live in
`docs/future/`, and the site doesn't link there.

**That plugins are reviewed, signed, or vetted.** There's no signing, no registry, no review, and no
deprecation program. Trust is decided on the person's own devices, and the site says exactly that.

**That a plugin's declared intent is enforced.** The Node half runs in a permission-scoped worker, and
the network, environment, file, and process grants in `permissions.node` are enforced. A plugin's
scheduled and task-check behavior is declared, because acorn can't verify what plugin code intends.
The permissions page keeps that split ([plugin node realm](../../security/plugin-node-realm.md)).

**A compatibility promise wider than the real one.** A plugin that loads under a plugin API major keeps
loading under it. The site doesn't promise that the major won't move, that an old major keeps working,
or any deprecation window.

**Claims it can't back with a number or a mechanism.** [Voice](./voice.md#rules) has the list.

**Internals a person doesn't need.** The broker, custody, migrations, the service protocol, package
boundaries, and tier audits stay in the internal docs.
