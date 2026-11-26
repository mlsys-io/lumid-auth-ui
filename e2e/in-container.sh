#!/usr/bin/env bash
# Run an e2e script with Chromium in its own network namespace.
#
# Why: on a host that is also a k3s node (the dev box is), every pod start or
# stop adds or removes a veth. Chrome treats any interface change as a network
# change and aborts EVERY in-flight request with net::ERR_NETWORK_CHANGED, so a
# long chat stream died at 12-30 s and the chat said "connection hiccup" while
# the server was fine (curl from the same box streamed the same turn to the end).
# A container sees only its own eth0.
#
# Usage: LUMID_PAT=... e2e/in-container.sh e2e/scenario-mlsys-serving.mjs
# Needs docker and Playwright's browsers on the host (npx playwright install).
set -euo pipefail
SCRIPT=${1:?script}
NODE_HOME=$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")
BROWSERS=${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}
CHROME_IN=${CHROME:+/ms/${CHROME#"$BROWSERS"/}}
REPO=$(cd "$(dirname "$0")/.." && pwd)
exec docker run --rm --init --shm-size=1g \
  -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -e LUMID_PAT -e LUMID_BASE -e SANDBOX_PY -e RUN_ID -e APP -e SRC_SLUG \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms ${CHROME_IN:+-e CHROME="$CHROME_IN"} \
  -v "$NODE_HOME:/opt/node:ro" -v "$BROWSERS:/ms:ro" \
  -v "$REPO:$REPO" -v /tmp:/tmp \
  -w "$REPO" mcr.microsoft.com/playwright/python:v1.49.0-jammy \
  /opt/node/bin/node "$SCRIPT"
