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

## The account service

An [account service](../account-api.md) is a different party from a control plane. A person chooses to
sign in to it, and it provisions nothing and holds no device token. Turning on remote access gives it a
Node's ID, a label, and the Node's certificate fingerprint, and nothing about what the Node does.

**It can send a client to a Node and raise a pairing request, so a breach could send you to an
impostor.** It signs relay tickets for any Node it lists and account assertions for any account. What
it can't do is approve a pairing or read relayed traffic. A relay forwards TLS the client pins, so an
impostor Node fails the pin as `identity_mismatch` unless the person pairs with it after comparing the
wrong identity words.

**Previews are the exception, so they're off until the owner turns them on.** A phone's browser pins no
key for a preview. The service controls the preview domain's DNS, so it can get a certificate for a
Node's preview names and read the page, its key and its cookie, then use the task's app as the owner
([who can read a preview](../relay/phone-channel.md#who-can-read-a-preview)).

A Node the account lists is checked against the fingerprint the account vouches for, which a breached
service chooses. It could list a relay of its own, forward a pairing ask to the real Node, and collect
the device token once the owner allows it. So an ask from another computer shows identity words at both
ends: the asker shows the words of the key it checked, and the owner's dialog shows the Node's own
([pairing by approval](../api-reference/transport.md#pairing-by-approval)). Through a relay in between,
the two sets differ, and the owner who compares them denies the request. An owner who allows it without
comparing hands the service a device token. Four things bound the rest:

- **Pairing is still a person's act.** A new device needs a code from a paired device or an approval
  from a device already paired with the Node. An assertion lets the owner account raise the dialog
  and nothing more.
- **The owner record isn't a grant.** `relay.json` names the owner account and the service's keys, and
  nothing in a Node lets an account in.
- **Tokens are short.** A ticket lasts five minutes and an assertion two. A relay credential lasts
  until the Node is removed or registers again, and removing the Node on the account website revokes it
  within seconds.
- **The service stores no task content.** Its tables hold accounts, Node labels, fingerprints, and relay
  routes.

**The account website serves the phone app, so a breach of it can act as every paired phone.** The
phone's device token sits where any script on the website's origin can use it. Changed files on the
website could read what a phone reads and make the writes a phone may make
([what a phone device may do](../relay/phone-channel/phone-devices.md#what-a-phone-device-may-do)). They can't run a
command on a Node, open a terminal, or approve an agent's command, unless the owner gave that phone
[shell access](../relay/phone-channel/phone-devices.md#shell-access) from a computer. A phone with shell access is a
terminal on the Node for whoever controls the website. Even so, no phone can sign the Node in or out,
turn remote access on or off, or change a Slack link or the Slack approvals choice.

Signing out deletes the connection on that Node, turns remote access off first, and revokes every phone's
device. A phone reaches the Node only through the account, so an owner who signs out of a breached
account cuts off every phone, a stolen one included. Computers stay paired. Turning remote access off
without signing out keeps phones, because the owner may turn it back on a minute later.

**A Node that linked Slack takes prompts from the service.** The Slack gateway delivers through the
relay with a gateway token, which opens one route, the Slack plugin's ([gateway routes](../authentication/gateway-routes.md)).
So a breach of the service could send a linked Node's agent a prompt as its owner, which spends the
owner's usage and runs gated. On a Node whose owner turned on **Answer approvals from Slack**, it could
approve what that agent asks to run, too. Both need a link that a paired device confirmed for that
exact Slack user. The box is unticked by default with this risk beside it, the Node checks every sender
against its own record of the owner, and every command in a Slack turn waits for a person's approval
([Slack](../integrations/slack.md#linking)). A breach can't add a Slack user of its own without that
confirmation.

## Node providers

A plugin-contributed node provider vouches for a Node's fingerprint. The desktop host probes that
endpoint and refuses a certificate whose fingerprint isn't the one vouched for. So a provider stands
in for the owner's eyes at the pairing step and nothing else. The device token never reaches the
renderer. The host fetches it from the Node that listed the record. See
[node providers](../plugins/node-providers.md).

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

No design moves the credential off the local Node. Until one does, don't take
the shortcut of a client-side provider. It would put the credential in the renderer, which is what all
three constraints exist to prevent.
