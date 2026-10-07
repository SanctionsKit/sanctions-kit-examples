# Supplier rows to an n8n review register

Keep every row of a supplier list visible when sanctions screening is incomplete, duplicated, or needs review. This example produces one JSON register with row-level outcomes and the successful screening results. It does not approve suppliers or save a spreadsheet, database row, or external review case.

Start with [supplier-review.offline.json](supplier-review.offline.json). It uses only n8n core nodes, invented suppliers, and local fixture responses. No account, community node, credentials, or network request is needed for that workflow.

The separate [supplier-review.sandbox.json](supplier-review.sandbox.json) is an API adaptation for `n8n-nodes-sanctionskit` **0.1.0**. When configured and executed, it sends the invented supplier rows to SanctionsKit's free synthetic sandbox. Its actual API outcomes need not match the offline fixture. Paid production screening is a separate configuration and is not implemented in these exports.

[SanctionsKit n8n guide](https://www.sanctionskit.com/integrations/n8n) · [API documentation](https://www.sanctionskit.com/docs) · [Sandbox](https://www.sanctionskit.com/docs/onboarding) · [Production plans](https://www.sanctionskit.com/pricing)

## Run the offline workflow

1. Import `supplier-review.offline.json` into n8n.
2. Open **Prepare supplier list** to inspect the nine invented input rows and `maxAttempts: 6`.
3. Execute the workflow manually.
4. Inspect the single item from **Supplier review register**. Its `rows` array contains every physical input row in its original order.

The graph is: manual trigger → prepare list → next row → attempt or finish. Each fixture response is recorded before the next row is selected. After the final attempt or a stopping fault, the register is emitted once.

The default fixture makes four simulated attempts:

| Row | Outcome | Meaning |
| --- | --- | --- |
| 1 | `review` | A synthetic candidate needs review. |
| 2 | `no_match` | No candidates in the selected synthetic coverage. No clearance is granted. |
| 3 | `duplicate` | Identical request to row 1; no second attempt or independent result. |
| 4–5 | `error` | Same stable key with different supplier names; both rows rejected before any attempt. |
| 6 | `error` | Invalid supplier name; no attempt. |
| 7 | `error` | Simulated row-specific request failure. |
| 8 | `unavailable` | Simulated coverage failure. |
| 9 | `unavailable` | Not attempted because row 8 stopped the run. |

See the exact [input fixture](fixtures/suppliers.json) and [example register](fixtures/example-register.json). `executionMode: offline_fixture` marks invented results. These fixture outcomes are not a claim about what the hosted sandbox returns for those names.

## Stable row keys and duplicate rules

Each request key is `sk-supplier:<listId>:<supplierId>:<revision>`. It is independent of row position and n8n execution ID. List and supplier IDs use 1–32 ASCII letters, digits, underscores, or hyphens; revision is a positive safe integer. Keep a stable list namespace instead of generating a new one on every delivery.

- An identical key and canonical request body appearing twice in one input list makes one attempt. Extra rows remain visible as `duplicate`, with `duplicateOfRow` pointing to the first physical row. That status does not assert that the first row succeeded.
- A repeated key with different request bodies rejects the entire conflicting group before any request. Fix the source data rather than choosing an arbitrary winner.
- For a manual retry of the same operation, preserve the exact key and body. A changed identity or a genuinely new screening needs a new revision/key. Do not change the key just to bypass a failed request.

The example deduplicates within one run. Repeated deliveries reuse API idempotency keys, subject to the API's [idempotency contract](https://www.sanctionskit.com/docs/idempotency); this is not a durable or indefinite exactly-once ledger. A production receiver needs its own unique constraints, authenticated input, request-body persistence, and retry policy.

The list is JSON rather than a CSV parser or spreadsheet connector. A spreadsheet adaptation must explicitly map a stable supplier ID, revision, name, and optional known country into this input shape. A physical row number is not a durable supplier ID. Country is supporting identity information, not a coverage selector.

## Configure the synthetic sandbox adaptation

The workflow is compatible with the published node's Create Screening operation and full response mode. It makes sequential individual requests; it does not use a native batch operation.

1. Follow the [n8n installation guide](https://www.sanctionskit.com/integrations/n8n) for a supported instance and install `n8n-nodes-sanctionskit` 0.1.0. Node approval and actual catalog/Cloud availability are separate; confirm availability on your instance.
2. [Create a SanctionsKit workspace](https://www.sanctionskit.com/signup), create a sandbox key with `screenings:write` and `sources:read` (the credential connection test reads the source catalog), and configure a **SanctionsKit API** n8n credential with environment `sandbox`. Store the key in n8n credentials, never in this JSON or a Code node.
3. Import `supplier-review.sandbox.json` and select that credential on **Screen one supplier in sandbox**.
4. Keep the invented input rows for the initial test. This variant does not contain `fixtureOutcome` input fields or a fixture response node.
5. Run manually and inspect **Supplier review register**. The full Create response is preserved on successful rows, including candidates, coverage, versions, and interpretation limits.

The node sends `subject.entityType: organization`, explicit empty `identifiers`, `package: sandbox@1`, standard retention, and the stable row key as the caller reference. Create responses do not return the retained subject/reference; row identity comes from the request state and n8n item linking. A successful result is not a full retained evidence bundle. To retrieve one, additionally grant `results:read` and use [Get Evidence](https://www.sanctionskit.com/docs/evidence) for that exact screening ID and validate its linkage before adding it to a stored record.

`maxAttempts` limits a run to 1–20 attempts; input is capped at 100 rows. There is no automatic retry. The workflow timeout is 900 seconds, above the 20 × 30-second HTTP-attempt bound plus processing overhead. A cancelled workflow, host failure, or instance-level limit can still prevent final output; the execution register is not crash-safe storage. Coverage, policy, access, allowance, rate-limit, and unknown failures stop subsequent requests. Remaining rows are marked unavailable and not attempted. Only the explicit row-specific codes `invalid_request`, `idempotency_conflict`, and `unsupported_entity_type` permit the next row to proceed. Resolve the recorded error before retrying with the same unchanged request.

Node 0.1.0 exposes continued failures as a sanitized error string, not a structured status/code object. This example recognizes its exact message format and does not infer a retry delay or an HTTP status. An unrecognized message stays an error and stops the run. If a workspace requires a policy that is not configured here, it will fail visibly; do not weaken the workspace's controls to make the demo pass.

## Retention and production limits

The register exists only as n8n execution output. How long it remains available depends on the instance's execution-saving and pruning settings. No database, spreadsheet, reviewer assignment, evidence download, webhook receiver, or external write is included. Review your n8n execution-data access and retention settings before adapting the workflow to real supplier details.

The sandbox version is deliberately guarded to synthetic coverage and `sandbox@1`. Do not switch its credential to production and assume it is ready. Production requires a paid plan, production credentials, selected available sources or a package, any required approved policy, and a reviewed adaptation of the response guards, storage, privacy, and retry behavior. Consult [source availability](https://www.sanctionskit.com/docs/sources), [errors](https://www.sanctionskit.com/docs/errors), [retention](https://www.sanctionskit.com/docs/retention), and [pricing](https://www.sanctionskit.com/pricing).

Every row keeps `businessDecision: not_decided`. Neither a candidate score nor a no-match result is a business approval or legal clearance.

## Local checks

Use Node.js 24 or later. The pure fixture checks have no dependencies:

```sh
npm --prefix integrations/n8n-supplier-review test
npm --prefix integrations/n8n-supplier-review run check
npm --prefix integrations/n8n-supplier-review run demo
```

Edit the pure functions, builder, or fixture and run `npm --prefix integrations/n8n-supplier-review run build` to regenerate both self-contained workflow JSON files and the example register. The builder embeds the same functions in n8n Code nodes; n8n does not need to load local modules.

Optional published-node contract test, with an independently unpacked `n8n-nodes-sanctionskit@0.1.0` package and its runtime dependencies available:

```sh
SANCTIONSKIT_NODE_PACKAGE=/absolute/path/to/package \
  npm --prefix integrations/n8n-supplier-review test
```

That test intercepts the node's HTTP helper and uses a clearly fake test credential. It makes no hosted request.

Optional native validation with an installed n8n **2.41.4** CLI:

```sh
N8N_BIN=/absolute/path/to/n8n/bin/n8n \
  node integrations/n8n-supplier-review/tests/native-runtime.cjs
```

The native check uses fresh temporary n8n state, imports/exports both variants twice, and executes only the core-node offline workflow. It asserts the actual final register, row count, outcome counts, and loop attempts. The sandbox workflow is not authenticated or executed by this check. It needs a local task-runner port; `N8N_TEST_RUNNER_PORT` selects one. Test reports and logs are written to a temporary directory printed on success, outside the repository.

## Verification recorded 6 October 2026

Both exact workflow files passed native n8n 2.41.4 import/export and a second clean round trip. The offline workflow executed successfully and produced all nine expected rows after four simulated attempts. Local checks passed 27 tests when the optional published-node contract test was enabled. The two synthetic result objects also passed a structure check against the current public OpenAPI schema. No authenticated sandbox or production execution is claimed.

## License

The example code and invented fixtures are covered by the repository's [MIT license](../../LICENSE). Hosted API use is subject to [SanctionsKit's terms](https://www.sanctionskit.com/terms).
