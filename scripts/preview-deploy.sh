#!/usr/bin/env bash
# Deploys the current checkout to a Vercel preview and prints its URL as the
# last line of stdout — the contract previewForPatch in
# services/orchestrator/src/repair-services.ts reads.
#
# Why a wrapper exists at all: `vercel deploy` prints the deployment URL to
# stderr and finishes stdout with JSON, so the bare command hands the Director
# a `}` and the repair loop dies at "Preview command must return a public
# HTTPS URL". Measured against a bare checkout of the demo storefront before
# it was wired in.
#
# Inherits env from the Director. Needs VERCEL_TOKEN, and either a linked
# .vercel/ directory or VERCEL_ORG_ID + VERCEL_PROJECT_ID so a fresh checkout
# can deploy without an interactive link step.
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"

# Everything the CLI says, both streams, so the URL is found wherever it lands.
output="$(npx --yes vercel deploy --yes --token "$VERCEL_TOKEN" 2>&1)" || {
  echo "$output" >&2
  echo "vercel deploy failed" >&2
  exit 1
}

url="$(printf '%s\n' "$output" | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -n 1 || true)"
if [[ -z "$url" ]]; then
  echo "$output" >&2
  echo "no deployment URL in vercel output" >&2
  exit 1
fi

# A URL that exists is not a URL that serves yet. Wait for it, so the Director
# never points a browser at a deployment still building.
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url/" || echo 000)"
  if [[ "$code" =~ ^[23] ]]; then
    echo "$url"
    exit 0
  fi
  sleep 5
done

echo "deployment never became reachable: $url" >&2
exit 1
