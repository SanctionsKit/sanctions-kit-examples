# SanctionsKit API example in Python

Send a screening request with Python 3.11 or later and the standard library. No pip dependencies.

## Run

[Create an account](https://www.sanctionskit.com/signup), then [create a sandbox API key](https://www.sanctionskit.com/dashboard/keys?environment=sandbox) with the `screenings:write` scope.

From the repository root:

```sh
export SANCTIONSKIT_API_KEY='YOUR_SANDBOX_KEY'
export REQUEST_KEY="$(python3 -c 'import uuid; print(uuid.uuid4())')"
python3 python/screen.py
```

The example screens the fictional Alex Morgan against `sandbox@1`, a package of synthetic records. It prints the full JSON response to standard output. Read `data.status`, `data.matches`, and `data.coverage` to understand the result.

HTTP errors print the status and response body to standard error and exit with a nonzero code. Network operations use a 30-second timeout. The script does not follow redirects or retry automatically. If you retry after a timeout, reuse the same `REQUEST_KEY` and unchanged request body. Generate a new key for a new screening.

Keep the API key on your server or in a trusted terminal. For a local mock server, set `SANCTIONSKIT_BASE_URL` to its API base URL; the script appends `/screenings`.

## Documentation

- [Quickstart](https://www.sanctionskit.com/docs/quickstart)
- [Screening requests and results](https://www.sanctionskit.com/docs/screenings)
- [Python tutorial](https://www.sanctionskit.com/integrations/python)
- [Errors and rate limits](https://www.sanctionskit.com/docs/errors)
- [Idempotency](https://www.sanctionskit.com/docs/idempotency)
- [All examples](../README.md)
