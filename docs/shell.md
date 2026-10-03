# Desktop shell

The desktop shell is a Tauri v2 application: a small Rust process that owns the window, the two custom
schemes, the menu, native dialogs, and one key in the OS keychain, plus a Node helper process it
supervises. Read this page to find the topic page that owns a part of the shell.

The shell owns no product data and no feature engines. The Node service is built separately and
staged into the bundle, and the shell starts it and brokers access to it. The Rust code is in
`apps/desktop/src-tauri/src/`, the helper's entry is `apps/desktop/src/helper/helperMain.ts`, and
custody, the broker, and supervision are in `packages/custody`.

The shell has three processes and one rule between them:

```text
Rust shell     window, app:// and app-plugin:// schemes, menu, dialogs, keychain, child webviews
  └─ helper    custody: broker, fleet, device tokens, plugin cache, tunnels (packages/custody)
       └─ Node service.js: data, routes, agents, plugins (apps/node)
Renderer       app://acorn, reaches the helper over one authenticated loopback WebSocket
```

The renderer never holds a Node token. Every byte to or from a Node goes through the helper's broker,
which pins certificates and adds the bearer.

## Pages

<a id="the-shell-process"></a>
<a id="startup-data-directory-environment-and-the-singleton-lock"></a>
<a id="keys-and-custody"></a>
<a id="device-config-file"></a>

[The shell process](./shell/process.md) covers startup, the Rust modules, the helper and its
renderer socket, the data directories, the data key, and the device config file.

<a id="node-child"></a>
<a id="service-protocol"></a>
<a id="what-the-helper-reports"></a>
<a id="the-switch-over-the-wire"></a>
<a id="what-the-shell-reports"></a>
<a id="active-renderer-responsiveness"></a>

[The Node child and shell telemetry](./shell/node-child.md) covers starting and supervising the local
Node, the crash budget, the service protocol, and what the helper and the Rust shell report.

<a id="renderer-origin-and-protocol-handler"></a>
<a id="the-syntax-highlighter-workers-separate-policy"></a>
<a id="the-plugin-worker"></a>
<a id="the-plugin-frame-origin"></a>
<a id="navigation-policy"></a>

[Origins and schemes](./shell/origins.md) covers `app://acorn` and its content security policy, the
highlighter worker's policy, `app-plugin://` for frames and tree workers, and the navigation policy.

<a id="the-renderer-bridge"></a>
<a id="connection-broker"></a>
<a id="fleet-membership"></a>
<a id="the-second-door-adopting-a-provided-node"></a>

[The renderer bridge and the connection broker](./shell/bridge-and-broker.md) covers `window.acorn`,
terminal bytes, dialogs, notifications, the broker, the fleet, and adopting a provided Node.

<a id="host-owned-webviews"></a>
<a id="background-scheduling-and-document-loss"></a>

[Host-owned webviews](./shell/webviews.md) covers the preview and plugin webviews, their history and
lifetime, the preview URL, and the dormant preview tunnel.

<a id="build-and-packaging"></a>
<a id="windows-test-installer"></a>
<a id="ci-permissions-and-signing-credentials"></a>
<a id="rust-dependency-security"></a>
<a id="signing-gates-and-the-updater"></a>

[Build and packaging](./shell/packaging.md) covers staging, bundle verification, the Windows
installer, CI permissions, Rust dependency findings, and the signing gates.

[Native overlays](./native-overlays.md) covers drawing host floating UI over native pages on macOS.
