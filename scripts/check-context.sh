#!/usr/bin/env bash
set -euo pipefail

base="${1:-origin/main}"
changes="$(git diff --name-only "$base"...HEAD)"
if [[ -z "$changes" ]]; then
  exit 0
fi
if ! grep -qx README.md <<< "$changes"; then
  echo 'A pull request must update README.md.' >&2
  exit 1
fi
if grep -Eqv '^(docs/|README\.md$)' <<< "$changes" && ! grep -qx PROJECT_CONTEXT.md <<< "$changes"; then
  echo 'A non-docs pull request must update PROJECT_CONTEXT.md.' >&2
  exit 1
fi
