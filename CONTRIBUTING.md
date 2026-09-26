# Contributing

Keep each example easy to copy into a new project. Prefer the language's standard HTTP library, short comments, and a single request over a reusable client framework.

When adding a language or changing a request:

- Follow the published [API reference](https://www.sanctionskit.com/docs/api-reference) and [OpenAPI document](https://www.sanctionskit.com/openapi.json).
- Use the same invented subject and `sandbox@1` package as the other examples.
- Read credentials and the request key from the environment.
- Preserve nonzero exits for failed requests and keep retries explicit.
- Include a short README with requirements, a run command, and links to the relevant docs.
- Add the example to the root README and test matrix.

## Run the checks

Install Python 3.9 or later plus the runtimes for the examples you changed. From the repository root:

```sh
python3 tests/smoke_test.py javascript typescript python ruby curl
```

Choose one or more of `curl`, `javascript`, `typescript`, `python`, `go`, `php`, `ruby`, `java`, and `csharp`, or pass `all` if every runtime is installed.

The checks start a local HTTP server and run the actual scripts against it. They check authentication, request bodies, response output, failed requests, and reuse of the request key. No live API credentials are used. GitHub Actions runs the same checks for each language.

Keep pull requests focused. Describe what changed and which checks you ran. Do not include API keys, real subject data, or private screening responses in issues, fixtures, or logs.
