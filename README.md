# SanctionsKit API examples

Simple sanctions screening API examples in JavaScript, TypeScript, Python, Go, PHP, Ruby, Java, C#, and cURL.

[SanctionsKit](https://www.sanctionskit.com/) provides an API for screening people and organizations against selected sanctions and watchlist sources. These examples show how to authenticate, submit a screening, and read the response using your language's HTTP library.

[Documentation](https://www.sanctionskit.com/docs) · [API reference](https://www.sanctionskit.com/docs/api-reference) · [Create an account](https://www.sanctionskit.com/signup) · [Get an API key](https://www.sanctionskit.com/dashboard/keys?environment=sandbox)

## Choose your language

| Language | HTTP client | Run from the repository root |
| --- | --- | --- |
| [cURL](curl/) | cURL | `bash curl/screen.sh` |
| [JavaScript](javascript/) | Built-in `fetch` | `node javascript/screen.mjs` |
| [TypeScript](typescript/) | Built-in `fetch` | `node typescript/screen.mts` |
| [Python](python/) | `urllib.request` | `python3 python/screen.py` |
| [Go](go/) | `net/http` | `go run ./go/main.go` |
| [PHP](php/) | cURL extension | `php php/screen.php` |
| [Ruby](ruby/) | `Net::HTTP` | `ruby ruby/screen.rb` |
| [Java](java/) | `HttpClient` | `java java/Screening.java` |
| [C#](csharp/) | `HttpClient` | `dotnet run --project csharp` |

Each directory has setup instructions and one standalone screening example. No SanctionsKit SDK is required.

## Workflow integrations

[n8n onboarding review](integrations/n8n/) routes a fictional onboarding event through screening, retained evidence, and four explicit review or incomplete-request outcomes. Import the credential-free offline demonstration to inspect ten synthetic cases, or use the separate sandbox workflow with the SanctionsKit node. Both preserve stable event identity and leave the onboarding decision open.

Run its local routing tests with `npm --prefix integrations/n8n test`. The README also describes the optional published-node contract and native n8n runtime checks.

[n8n supplier review register](integrations/n8n-supplier-review/) keeps every invented supplier row visible, including duplicates, conflicts, errors, and unavailable coverage. Import the credential-free offline demo or configure the separate synthetic sandbox adaptation. It produces execution output without approving suppliers or claiming an external saved register.

Run its local checks with `npm --prefix integrations/n8n-supplier-review test` and `npm --prefix integrations/n8n-supplier-review run check`.

[Windmill](integrations/windmill/) takes a fictional onboarding contact through a synthetic screening and retrieves the evidence for that same result. It includes a credential resource, importable script, example output, and local tests. Both screening outcomes leave the onboarding decision open for review.

Run its local HTTP tests with Node.js 24 or later:

```sh
npm --prefix integrations/windmill test
```

[Node-RED](integrations/node-red/) includes an importable flow built with core nodes. Run a fictional screening, retrieve its evidence, and inspect a review record. It keeps credentials in the process environment and reuses a stable request key for manual retries. The README includes setup instructions and local runtime tests.

[Kestra](integrations/kestra/) submits a fictional batch, waits for its final state, and exports retained evidence and a CSV row summary. It keeps failed and cancelled rows visible for review. The Kestra 2.0.4 flow passed 24 native scenarios against a local HTTP fixture in an isolated container.

## Make your first request

1. [Create a workspace](https://www.sanctionskit.com/signup), then open [API keys](https://www.sanctionskit.com/dashboard/keys?environment=sandbox).
2. Create a **sandbox** key with `screenings:write` and `results:read` scopes.
3. Set your key and a unique request key in your terminal, then run an example.

For example, with Node.js 24 or later:

```sh
export SANCTIONSKIT_API_KEY='your-sandbox-api-key'
export REQUEST_KEY="$(node -p 'crypto.randomUUID()')"
node javascript/screen.mjs
```

Keep API keys in your server environment. Never commit them or include them in browser code. Each language README includes its own setup command; C# also includes PowerShell instructions.

The standalone language examples send this body to `https://www.sanctionskit.com/api/v1/screenings`:

```json
{
  "subject": {
    "name": "Alex Morgan",
    "entityType": "person",
    "birthDate": "1984"
  },
  "package": "sandbox@1",
  "reference": "example-customer-001",
  "retention": "standard"
}
```

The person is invented. `sandbox@1` uses synthetic records, so this request does not search live sanctions lists. See the [quickstart](https://www.sanctionskit.com/docs/quickstart) for a walkthrough.

## Read the response

A successful screening returns HTTP `201` with a `data` object. The examples print the full response so you can inspect it.

| Field | Meaning |
| --- | --- |
| `data.id` | The screening ID, used to retrieve the saved result. |
| `data.status` | `potential_match` or `no_match`. |
| `data.matches` | Candidate records and the evidence behind each match. |
| `data.coverage` | The source versions and freshness used for this screening. |
| `data.versions` | The dataset, matching engine, and policy versions. |

`potential_match` means the candidates need review. `no_match` applies to the selected sources and supplied information; it is not a clearance decision. Keep the coverage and evidence with the result. The [screening guide](https://www.sanctionskit.com/docs/screenings) explains the full response and how to retrieve it later.

These scripts display responses for learning. When adapting them to an application, parse the JSON, handle the result status, and store evidence where only authorized people can access it. Keep real subject details out of routine logs.

## Retry a request

`REQUEST_KEY` is sent as the `Idempotency-Key` header. Generate it once for a new screening. If a request times out or needs a retry, keep **the same key and the same body**. Rerun the script without repeating the key-generation command. A new subject or changed body needs a new key.

The standalone language examples make one attempt and exit with a nonzero status on an HTTP or network error. They do not retry automatically. An error is an incomplete request, never a `no_match` result. See [idempotency](https://www.sanctionskit.com/docs/idempotency) and [error handling](https://www.sanctionskit.com/docs/errors) before adding retries to an application.

## Adapt the example

For an organization, change `subject` to:

```json
{
  "name": "Example Trading Company",
  "entityType": "organization"
}
```

Create a new request key for the changed body. Optional fields and supported subject types are covered in the [API reference](https://www.sanctionskit.com/docs/api-reference).

For production, create a production API key and replace `sandbox@1` with a package available to that environment, or remove `package` and supply `sources`. Send exactly one coverage selector. Review [source availability](https://www.sanctionskit.com/docs/sources), [plans](https://www.sanctionskit.com/pricing), and [retention](https://www.sanctionskit.com/docs/retention) first. If your workspace requires an approved policy, include its ID and version as described in the [screening guide](https://www.sanctionskit.com/docs/screenings).

For larger integrations, the docs cover [batch screening](https://www.sanctionskit.com/docs/batches), [monitoring](https://www.sanctionskit.com/docs/monitoring), and [webhooks](https://www.sanctionskit.com/docs/webhooks). The [cURL examples](curl/) also show source discovery and result retrieval.

## Configuration

| Variable | Purpose |
| --- | --- |
| `SANCTIONSKIT_API_KEY` | Required. Your sandbox API key. |
| `REQUEST_KEY` | Required. A unique key for one screening operation. |
| `SANCTIONSKIT_BASE_URL` | Optional. Defaults to `https://www.sanctionskit.com/api/v1`. Used by the local tests. |

The scripts read environment variables directly; they do not load `.env` files.

## Contributing

Small, runnable examples are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the local checks. The test suite uses a local HTTP server and never needs an API key or a SanctionsKit account.

For API help, visit the [documentation](https://www.sanctionskit.com/docs) or [contact SanctionsKit](https://www.sanctionskit.com/contact). For a problem with an example, open a GitHub issue without including credentials or personal data.

## License

[MIT](LICENSE). The license covers the code in this repository. Use of the hosted API is subject to [SanctionsKit's terms](https://www.sanctionskit.com/terms).
