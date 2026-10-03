# The three parties

This page states what an optional control plane may hold, and the two seams that connect one to
acorn. Read it before you design anything that stores Node metadata outside a Node.

A **client** coordinates across the Nodes it can see. A **Node** owns its data and drives its own
work. A **control plane** is an optional third party that holds metadata about Nodes and vouches for
them. It's never in the data path. acorn ships the two seams a control plane uses, but no control
plane. [The cloud programme](../future/cloud/README.md) proposes one.

The rule for a control plane: it stores what it takes to find a Node and vouch for it, and nothing
about what the Node is doing. Node inventory, endpoints, fingerprints, enrollment records, provider
handles, accounts, and billing are allowed. Tasks, repository contents, agent transcripts, and run
history aren't. That keeps the control plane replaceable, keeps the trust story to one sentence in
[security](../security.md) § The control plane, and leaves every `/v1` route unchanged. A Node with no
account and no control plane is the fully usable default.

Two seams connect a control plane, and both are inert until configured:

- A Node can enroll with a control plane at first boot. See [node enrollment](../node-enrollment.md).
- A plugin can contribute a Node provider, which puts Nodes in the fleet. See [plugins](../plugins.md)
  § Node providers.

Core has no `nodes` table. The provider answers, the client merges, the desktop stores what it adopts,
and `node.json` gains one optional record.
