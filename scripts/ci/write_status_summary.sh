#!/usr/bin/env bash
set -euo pipefail

TITLE="${SUMMARY_TITLE:-Status}"
SCOPE="${SUMMARY_SCOPE:-}"
OUTCOME="${SUMMARY_OUTCOME:-}"
SPEC="${SUMMARY_SPEC:-}"
PROJECT="${SUMMARY_PROJECT:-}"
COMMAND="${SUMMARY_COMMAND:-}"
ARTIFACT="${SUMMARY_ARTIFACT:-}"
RUN_URL="${SUMMARY_RUN_URL:-}"
TIMESTAMP_UTC="${SUMMARY_TIMESTAMP_UTC:-}"

{
  echo "## ${TITLE}"
  [[ -n "$SCOPE" ]] && echo "- Scope: ${SCOPE}"
  [[ -n "$OUTCOME" ]] && echo "- Outcome: **${OUTCOME}**"
  [[ -n "$SPEC" ]] && echo "- Spec: \`${SPEC}\`"
  [[ -n "$PROJECT" ]] && echo "- Project: \`${PROJECT}\`"
  [[ -n "$COMMAND" ]] && echo "- Command: \`${COMMAND}\`"
  [[ -n "$ARTIFACT" ]] && echo "- Artifact: \`${ARTIFACT}\`"
  [[ -n "$RUN_URL" ]] && echo "- Run page: ${RUN_URL}"
  [[ -n "$TIMESTAMP_UTC" ]] && echo "- Timestamp (UTC): \`${TIMESTAMP_UTC}\`"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
