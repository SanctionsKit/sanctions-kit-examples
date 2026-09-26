# SanctionsKit API with cURL

Send a sandbox screening request from your terminal. Requires Bash and cURL.

## Run

Create a [sandbox API key](https://www.sanctionskit.com/dashboard/keys?environment=sandbox) with `screenings:write` and `results:read`. Add `sources:read` if you want to try source discovery below. The [quickstart](https://www.sanctionskit.com/docs/quickstart) covers account setup.

From the repository root:

```sh
export SANCTIONSKIT_API_KEY='your-sandbox-api-key'
export REQUEST_KEY="$(uuidgen)"
bash curl/screen.sh
```

`uuidgen` is included on macOS and available in the `uuid-runtime` package on Debian and Ubuntu. Any unique UUID works.

The script sends an invented person to `POST /api/v1/screenings` with the synthetic `sandbox@1` package and prints the full JSON response. HTTP and network errors exit with a nonzero status. Keep the same `REQUEST_KEY` and body when retrying; generate a new key for a new screening.

## Discover sources

```sh
curl --fail-with-body --silent --show-error --max-time 30 \
  'https://www.sanctionskit.com/api/v1/sources' \
  -H "Authorization: Bearer $SANCTIONSKIT_API_KEY"
```

This command needs cURL 7.76 or later. See [source selection](https://www.sanctionskit.com/docs/sources) before choosing production coverage.

## Retrieve a result

Set `SCREENING_ID` to `data.id` from the screening response:

```sh
export SCREENING_ID='paste-the-screening-id'
curl --fail-with-body --silent --show-error --max-time 30 \
  "https://www.sanctionskit.com/api/v1/results/$SCREENING_ID" \
  -H "Authorization: Bearer $SANCTIONSKIT_API_KEY"
```

Read the [screening guide](https://www.sanctionskit.com/docs/screenings), [idempotency guide](https://www.sanctionskit.com/docs/idempotency), and [error reference](https://www.sanctionskit.com/docs/errors) for request fields, result meanings, and retry behavior.

[All examples](../README.md)
