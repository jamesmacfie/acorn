#!/bin/sh
# Committed fake agent (plan §validation): stands in for claude/codex in headless-runner tests —
# real CLIs are NEVER invoked. Emits canned stream-json shaped like `claude -p --output-format
# stream-json`, including a schema-conforming structured final message. Modes via FAKE_AGENT_MODE:
#   ok (default) → events + result (structured output from FAKE_AGENT_STRUCTURED or a default)
#   fail         → exits 2 with stderr
#   hang         → sleeps 60s (the timeout-kill path)
#   malformed    → exit 0 with garbage output
MODE="${FAKE_AGENT_MODE:-ok}"

# `--report <file>` first, and then the run continues as normal: dump what this process was actually
# handed — argv, cwd, how many entries that cwd holds, and the whole environment — one `<key> <value>`
# line each. It is an argument rather than an env variable because the callers under test build the
# child environment from an allowlist, so nothing a test sets would survive the trip; argv is the only
# channel into a contained spawn. Values with a newline in them would break the line format, so keep
# test prompts on one line.
if [ "$1" = "--report" ]; then
  REPORT="$2"
  shift 2
  {
    echo "cwd $PWD"
    echo "entries $(ls -A . | wc -l | tr -d ' ')"
    for ARG in "$@"; do echo "arg $ARG"; done
    env | sed 's/^/env /'
  } > "$REPORT"
fi

case "$MODE" in
  fail)
    echo '{"type":"system","subtype":"init","session_id":"fake-fail"}'
    echo "fake-agent: simulated failure" >&2
    exit 2
    ;;
  hang)
    sleep 60
    ;;
  malformed)
    echo 'this is not json'
    echo 'still not json'
    exit 0
    ;;
  *)
    STRUCTURED="$FAKE_AGENT_STRUCTURED"
    [ -z "$STRUCTURED" ] && STRUCTURED='{"verdict":"pass","blocking":false}'
    echo '{"type":"system","subtype":"init","session_id":"fake-sess-1","model":"fake"}'
    echo '{"type":"assistant","message":{"content":[{"type":"text","text":"working on it"}]},"session_id":"fake-sess-1"}'
    printf '{"type":"result","subtype":"success","result":"Done: reviewed the change.","structured_output":%s,"session_id":"fake-sess-1","total_cost_usd":0.0123}\n' "$STRUCTURED"
    ;;
esac
