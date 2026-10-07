#!/usr/bin/env bash
# Prints first-turn context tokens for Claude Code and Codex with the fixture server in each phase 08
# mode, plus a run with no acorn server. Each run sends one short prompt and spends a little usage.
#
#   ./measure.sh            # both clients
#   ./measure.sh claude     # one client
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work" && git init -q
prompt='Reply with the single word OK.'
modes=(none tools tools-and-resources resources-and-write-tools)

claude_run() {
  local config='{"mcpServers":{}}'
  [ "$1" = none ] || config="{\"mcpServers\":{\"acorn\":{\"command\":\"node\",\"args\":[\"$here/server.mjs\",\"$1\"]}}}"
  claude -p "$prompt" --output-format stream-json --verbose --strict-mcp-config --mcp-config "$config" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=s.split("\n").filter(l=>l.startsWith("{")).map(JSON.parse).find(x=>x.type==="assistant");const u=a.message.usage;console.log(u.input_tokens+(u.cache_creation_input_tokens??0)+(u.cache_read_input_tokens??0))})'
}

codex_run() {
  local args=()
  [ "$1" = none ] || args=(-c 'mcp_servers.acorn.command="node"' -c "mcp_servers.acorn.args=[\"$here/server.mjs\",\"$1\"]")
  codex exec --json --skip-git-repo-check --ephemeral ${args[@]+"${args[@]}"} "$prompt" </dev/null 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=s.split("\n").filter(l=>l.startsWith("{")).map(JSON.parse).find(x=>x.type==="turn.completed");console.log(t.usage.input_tokens)})'
}

for client in ${1:-claude codex}; do
  for mode in "${modes[@]}"; do
    printf '%-7s %-26s %s\n' "$client" "$mode" "$("${client}_run" "$mode")"
  done
done
