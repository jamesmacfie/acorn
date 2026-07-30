# Local and remote topologies

Status: **Normative**
Requirement prefix: `ARCH-TOPO`

## Bundled local Node

- **ARCH-TOPO-001** A bundled Node binds an ephemeral loopback port selected by the OS and advertises
  it only over the supervised bootstrap channel.
- **ARCH-TOPO-002** It uses TLS 1.3 and mTLS like a remote Node. The initial local device
  certificate is provisioned through an OS-user-protected bootstrap, not a shared bearer token.
- **ARCH-TOPO-003** Local mode MUST NOT depend on DNS, marketplace availability or a relay after
  required artifacts are installed.

## Standalone Node

A standalone Node may bind a configured interface only after:

1. generating/importing a stable Node identity;
2. presenting its fingerprint to the operator;
3. validating TLS endpoint names or a pinned certificate;
4. confirming host full-disk encryption; and
5. setting explicit advertised endpoints.

- **ARCH-TOPO-004** Automatic public internet exposure, UPnP/NAT-PMP port mapping and plaintext LAN
  discovery are prohibited.
- **ARCH-TOPO-005** Optional local discovery MAY use mDNS to advertise only service type,
  non-secret Node ID, port and certificate fingerprint. Pairing still requires fingerprint and a
  one-time code.
- **ARCH-TOPO-006** Endpoint discovery MUST be treated as untrusted input. The pinned Node identity,
  not DNS or mDNS name, determines trust.

## Direct remote operation

V2 supports operator-provided DNS/IP endpoints, VPN/overlay addresses and SSH-managed private
networks so long as Electron establishes direct TLS 1.3 mTLS to the Node. A load balancer or reverse
proxy in front of V2 MAY provide only layer-four byte-for-byte TLS passthrough. The exact Node
certificate, client certificate, TLS exporter and pinned Node identity MUST terminate at the Node
and Client. TLS termination, certificate forwarding, proxy identity, trusted headers and
application gateways are unsupported and MUST fail before application dispatch. A future
terminating-proxy trust mode would require a separately versioned end-to-end signed-request
protocol and owner ceremony; it cannot be enabled by V2 configuration.

- **ARCH-TOPO-010** Conformance probes the externally advertised endpoint and rejects a topology
  when the peer certificate or TLS exporter is not the Node's, including a proxy that forwards
  otherwise valid device metadata. Pass-through infrastructure has no Acorn identity or authority.

## Future relay constraint

- **ARCH-TOPO-007** A future relay MUST see only routing metadata, bounded ciphertext frames and
  traffic timing. Application messages require client-to-Node authenticated encryption inside the
  relay transport.
- **ARCH-TOPO-008** Relay routing credentials MUST NOT authorize Node commands. Relay compromise
  MUST NOT reveal provider credentials, resource bodies, command payloads or UI documents.
- **ARCH-TOPO-009** Direct and relayed transports MUST carry identical versioned application
  messages and node-qualified identities. Relay ordering, duplication and reconnect behavior MUST
  be handled like an unreliable transport.

The relay protocol, service, account model, push notifications and NAT traversal are not V2
deliverables.

## Network changes

Endpoint candidates are mutable hints signed by the Node and accepted only over an already
authenticated session or a freshly fingerprint-verified pairing. A client tries candidates in
configured order with 3-second connection timeouts, exponential reconnect capped at 60 seconds and
jitter. Endpoint failure never changes the pinned Node ID or fingerprint.
