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

## n8n workflow examples

The [onboarding review](integrations/n8n/) and [supplier review register](integrations/n8n-supplier-review/) examples have separate fixture suites and CI path filters. Run the checks for the example you changed:

```sh
npm --prefix integrations/n8n test
npm --prefix integrations/n8n run build
git diff --exit-code -- integrations/n8n/onboarding-review.offline.json integrations/n8n/onboarding-review.sandbox.json

npm --prefix integrations/n8n-supplier-review test
npm --prefix integrations/n8n-supplier-review run check
```

After changing source functions or fixtures, regenerate that example's workflow files with its `npm run build` command and review the generated diff. Each README documents optional published-node contract tests and native n8n import/export checks. Only offline fixture workflows are executed by those native checks; do not use live credentials or real subjects for repository validation.
