#!/usr/bin/env bash
set -euo pipefail

: "${SANCTIONSKIT_API_KEY:?Set SANCTIONSKIT_API_KEY to your sandbox API key.}"
: "${REQUEST_KEY:?Set REQUEST_KEY to a UUID for this screening.}"

base_url="${SANCTIONSKIT_BASE_URL:-https://www.sanctionskit.com/api/v1}"
response=$(mktemp)
trap 'rm -f "$response"' EXIT

status=$(curl --silent --show-error --max-time 30 \
  --output "$response" --write-out '%{http_code}' \
  "${base_url%/}/screenings" \
  -H "Authorization: Bearer $SANCTIONSKIT_API_KEY" \
  -H "Idempotency-Key: $REQUEST_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "subject": {
      "name": "Alex Morgan",
      "entityType": "person",
      "birthDate": "1984"
    },
    "package": "sandbox@1",
    "reference": "example-customer-001",
    "retention": "standard"
  }')

if [[ "$status" != 2?? ]]; then
  printf 'HTTP %s\n' "$status" >&2
  cat "$response" >&2
  exit 1
fi

cat "$response"
printf '\n'
