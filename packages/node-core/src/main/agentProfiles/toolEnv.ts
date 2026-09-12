// Configuration an agent CLI may inherit from the host. Credentials stay out: the CLI authenticates
// through its own stored login, while proxy and TLS settings are needed on managed networks.
export const AGENT_TOOL_PASSTHROUGH = [
  'XDG_CONFIG_HOME',
  'npm_config_prefix',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const
