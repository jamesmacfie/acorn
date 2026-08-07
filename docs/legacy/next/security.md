# Future security work

This is proposal material only. The shipped baseline is in [security.md](../security.md) and
[authentication.md](../authentication.md); those documents describe the current `/v2` device-token
runtime.

Possible future work must preserve the current loopback-only TLS listener, certificate pinning,
device/internal principals, scoped child tokens, config-trust gate, process broker, preview isolation,
provider normalization, and audit surface.

Potential follow-ups include stronger release signing/notarization, explicit credential policy for
every provider route, an operator-facing standalone-node pairing ceremony, and a future external
control principal. None is part of the current protocol, and this directory must not be used as a
source for shipped routes or settings.
