#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --redact --no-banner --log-level error --log-opts 'main..HEAD'
  gitleaks git --staged --redact --no-banner --log-level error
else
  echo 'gitleaks is not installed; CI will scan the full history.' >&2
fi

pnpm format:check
pnpm lint
pnpm typecheck
pnpm schema:check
pnpm test
pnpm build
git diff --check
git diff --cached --check
