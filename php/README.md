# SanctionsKit API with PHP

Screen an invented person using PHP 8.2 or later and the cURL extension. No Composer packages are needed.

## Run

Create a [sandbox API key](https://www.sanctionskit.com/dashboard/keys?environment=sandbox) with `screenings:write` and `results:read`. New to SanctionsKit? Start with the [quickstart](https://www.sanctionskit.com/docs/quickstart).

From the repository root:

```sh
export SANCTIONSKIT_API_KEY='your-sandbox-api-key'
export REQUEST_KEY="$(php -r 'echo bin2hex(random_bytes(16));')"
php php/screen.php
```

Check that the extension is installed with `php --ri curl`.

The example posts to `/api/v1/screenings` using the synthetic `sandbox@1` package and prints the full JSON response. HTTP and network errors exit with a nonzero status. Keep the same `REQUEST_KEY` and body when retrying a request. Create a new key for a new screening or a changed request.

Edit the `$body` array to change the subject. See the [screening guide](https://www.sanctionskit.com/docs/screenings) for fields and result meanings, [idempotency](https://www.sanctionskit.com/docs/idempotency) for retries, and the [error reference](https://www.sanctionskit.com/docs/errors) for failures.

[All examples](../README.md)
