# The control plane

This page covers what it costs to let something other than a person provision a Node: a control plane
through enrollment, or a plugin-contributed node provider. Read it before you build anything that uses
either seam. It's part of the [security model](../security.md). [Node enrollment](../node-enrollment.md)
owns the protocol, and [the three parties](../architecture/control-plane.md) owns what a control
plane may hold.

## What enrolling costs

A control plane creates a machine, passes an enrollment token in through the environment, and the
Node introduces itself on first boot. The path is off by default and does nothing when unconfigured.

**A control plane learns a device token for every Node it provisioned, so trusting your control plane
is the whole game.** A device token is full owner authority on that Node, with no per-token scopes
([device tokens](../authentication.md#device-tokens)). Enrolling isn't registering an inventory record.
It hands a service the same credential a paired client of yours holds.

The web client has the same inversion. When a Node serves the app, the Node is the origin, and
per-bundle consent stops being the real consent surface, because whoever controls the Node controls
the page that asks. In both cases the thing you chose to trust is the thing you're trusting, and no
mechanism further down rescues a bad choice.

## What bounds it

Four things keep the cost bounded:

- **Two tokens, not one.** The enrollment token is single-use and short-lived. The device token is
  the durable credential. A leaked provisioning secret doesn't become a standing one.
- **The attachment is visible.** Settings → Nodes names the control plane a Node is attached to,
  since when, and under which enrollment token, read from that Node's own `node.json`.
- **Detaching is one button, and it revokes.** It deletes the control plane's device row, so the
  credential stops working at once, and changes nothing else. A detached Node keeps working on its
  own.
- **`node.enrolled` and `node.detached` are on the audit trail**, with failures too. A provisioned
  Node that couldn't reach its control plane says so.

There's no allowlist of permitted control-plane URLs. Whoever set the environment variable made that
decision, and a list acorn ships would be theatre over a choice it can't see. The scheme is enforced:
plain `http` is refused for anything but loopback, because a durable credential must not cross a
network in the clear.

## Node providers

A plugin-contributed node provider vouches for a Node's fingerprint. The desktop host probes that
endpoint and refuses a certificate whose fingerprint isn't the one vouched for. So a provider stands
in for the owner's eyes at the pairing step and nothing else. The device token never reaches the
renderer. The host fetches it from the Node that listed the record. See
[node providers](../plugins.md#node-providers).

A provider's own connection to its control plane is an ordinary connection, held by the Node the
plugin runs on. On a desktop install that's the local Node, so the cloud account credential sits on
the owner's machine beside every other integration token. That stops being right for a web client,
which has no local Node, and the credential would have to move to a Node the owner picked.

Three constraints in the code keep that move additive:

1. Fleet-shaped reads fan out over every Node and union the results, so a provider answering from
   another Node changes no caller.
2. Node providers register Node-side and have no client-side seam, so nothing on the client holds
   provider state.
3. `providerNodeId`, not the endpoint, is the control plane's identity for a Node, so a record
   survives being reached from somewhere else.

[Remote access](../future/remote.md) is the design that moves the credential. Until then, don't take
the shortcut of a client-side provider. It would put the credential in the renderer, which is what all
three constraints exist to prevent.
