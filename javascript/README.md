# SanctionsKit API example in JavaScript

Send a screening request with Node.js 24 or later and its built-in `fetch`. No npm dependencies.

## Run

[Create an account](https://www.sanctionskit.com/signup), then [create a sandbox API key](https://www.sanctionskit.com/dashboard/keys?environment=sandbox) with the `screenings:write` scope.

From the repository root:

```sh
export SANCTIONSKIT_API_KEY='YOUR_SANDBOX_KEY'
export REQUEST_KEY="$(node -p 'require("node:crypto").randomUUID()')"
node javascript/screen.mjs
```

The example screens the fictional Alex Morgan against `sandbox@1`, a package of synthetic records. It prints the full JSON response to standard output. Read `data.status`, `data.matches`, and `data.coverage` to understand the result.

HTTP errors print the status and response body to standard error and exit with a nonzero code. The request has a 30-second timeout and does not follow redirects or retry automatically. If you retry after a timeout, reuse the same `REQUEST_KEY` and unchanged request body. Generate a new key for a new screening.

Keep the API key on your server or in a trusted terminal. For a local mock server, set `SANCTIONSKIT_BASE_URL` to its API base URL; the script appends `/screenings`.

## Documentation

- [Quickstart](https://www.sanctionskit.com/docs/quickstart)
- [Screening requests and results](https://www.sanctionskit.com/docs/screenings)
- [Node.js and TypeScript tutorial](https://www.sanctionskit.com/integrations/typescript)
- [Errors and rate limits](https://www.sanctionskit.com/docs/errors)
- [Idempotency](https://www.sanctionskit.com/docs/idempotency)
- [All examples](../README.md)
