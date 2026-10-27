#!/bin/sh
# The installed codex on a local model, through scripts/codex-local.ts and in
# a Codex home of its own, so your own Codex sessions and sign-in are not
# touched: for trying the Codex backend without a ChatGPT plan. Give it to
# the window as CODEX_PATH. It answers `codex login status` as signed in,
# since a local model needs no sign-in.
#   CODEX_REAL          the codex to run (default: codex on PATH)
#   CODEX_LOCAL_URL     the proxy (default http://127.0.0.1:8090/v1)
#   CODEX_LOCAL_HOME    its Codex home (default ~/.cache/harness-codex-local)
export CODEX_HOME="${CODEX_LOCAL_HOME:-$HOME/.cache/harness-codex-local}"
mkdir -p "$CODEX_HOME"
if [ "$1" = login ]; then echo "Logged in (a local model)"; exit 0; fi
exec "${CODEX_REAL:-codex}" "$@" \
  -c 'model_provider="local"' \
  -c "model_providers.local={name=\"local\",base_url=\"${CODEX_LOCAL_URL:-http://127.0.0.1:8090/v1}\",wire_api=\"responses\"}" \
  -c 'model="local"' -c 'model_context_window=65536'
