# SanctionsKit API example in Go

Requires Go 1.22 or newer. Uses the standard library.

Create a [sandbox API key](https://www.sanctionskit.com/dashboard/keys?environment=sandbox) with `screenings:write` and `results:read`, then run from the repository root:

```sh
export SANCTIONSKIT_API_KEY='your-sandbox-api-key'
export REQUEST_KEY="$(uuidgen)"
go run ./go/main.go
```

The example screens a fictional person using the synthetic `sandbox@1` package and prints the full JSON response. It makes one request with a 30-second timeout. HTTP and network errors exit with a nonzero status.

Keep the same `REQUEST_KEY` and request body when retrying that screening. Generate a new key for a new screening. See [idempotency](https://www.sanctionskit.com/docs/idempotency) and [error handling](https://www.sanctionskit.com/docs/errors) for details.

`uuidgen` is included on macOS and available in the `uuid-runtime` package on Debian and Ubuntu. Any unique UUID works.

Read the [quickstart](https://www.sanctionskit.com/docs/quickstart) and [screenings documentation](https://www.sanctionskit.com/docs/screenings), or browse [all examples](../README.md).
