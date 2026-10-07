# Route onboarding screenings for review in n8n

Turn a fictional onboarding event into a screening request, retrieve the evidence for the same result, and keep four outcomes separate. Every output retains `onboardingDecision: "not_made"`. The example never approves a customer or treats a screening result as legal clearance.

## Choose an import

| Workflow | What it does | Requirements |
| --- | --- | --- |
| [Offline demonstration](onboarding-review.offline.json) | Runs ten invented cases through the actual Code and Switch nodes. No network requests. | n8n; no SanctionsKit account, node package, or credentials |
| [Synthetic sandbox workflow](onboarding-review.sandbox.json) | Screens one invented person and retrieves the retained evidence using SanctionsKit nodes. | n8n, `n8n-nodes-sanctionskit@0.1.0`, your own sandbox credential |

Import the JSON through n8n's **Import from File** action, then choose **Execute workflow**. The workflows are inactive and use a manual trigger. Open the final nodes to inspect the records. The offline demonstration deliberately fabricates successful and failed responses; it does not predict a live response for any name.

For the sandbox version, [create a SanctionsKit workspace](https://www.sanctionskit.com/signup) and a [sandbox key](https://www.sanctionskit.com/dashboard/keys?environment=sandbox) with `sources:read`, `screenings:write`, and `results:read`. The credential's **Test** action reads the source catalog and requires `sources:read`; the workflow creates screenings with `screenings:write` and retrieves evidence with `results:read`. Store the key in an n8n **SanctionsKit API** credential with environment **Sandbox**, then select that credential on both SanctionsKit nodes. No credential is embedded in either export. Install the package using the [n8n integration guide](https://www.sanctionskit.com/integrations/n8n) and the installation options available on your n8n instance. Approval as a verified node and availability in your instance are separate; use the package only where your instance supports it.

The free sandbox uses synthetic records. Production screening is paid and requires production credentials and explicitly selected, available coverage. This workflow intentionally fixes coverage to `sandbox@1` and rejects results from other environments.

## What moves through the workflow

1. **Synthetic onboarding events** supplies an invented `Alex Morgan` person and a stable event ID.
2. **Map onboarding event** derives `n8n:<eventId>` as the request key, uses the event ID as the retained reference, and requests standard retention. It accepts a name and an optional known birth year; it does not invent missing identity details. Invalid input stops before the API node.
3. **Screen synthetic subject** creates a screening with full output. No automatic retry is configured.
4. **Classify screening response** validates the result and sends failed or unavailable requests directly to an incomplete branch.
5. **Get same screening evidence** retrieves the exact returned screening ID. **Build review record** verifies that the evidence agrees with the original result, event reference, submitted subject, and retained request. It preserves the complete result and evidence document, including candidate evidence, versions, freshness, notices, and interpretation limits.
6. **Route review record** sends each event to one of four inspection nodes.

| Final node | Meaning |
| --- | --- |
| Potential match — human review | Candidate records need review. The evidence document is present. |
| No match — apply organization policy | No candidates were returned within the selected coverage and matching rules. Apply your own decision policy; the workflow makes no approval. |
| Request or evidence error — incomplete | Authentication, idempotency conflict, expired evidence, malformed data, mismatched evidence, and unrecognized failures remain incomplete. |
| Coverage unavailable — incomplete | Unavailable/stale coverage, missing coverage, or freshness failure cannot become a no-match result. |

All four final nodes are **No Operation** inspection endpoints. They do not create a review case, write to a CRM, send notifications, or persist a queue. n8n may retain execution data according to its own settings; that is not a durable business decision record. A successful n8n execution means the routing completed, not that onboarding or all screenings succeeded. Inspect each record's `route` and `stage`.

The v0.1.0 SanctionsKit node's continued errors contain a sanitized `error` message, not a structured HTTP status and code. This example recognizes only the exact documented-in-code message pattern for `coverage_unavailable` and `stale_coverage`; every unknown error remains `request_error`. On a node upgrade, rerun the contract tests before relying on that classification.

## Stable events and retries

The event ID identifies one immutable screening request. Keep the same event ID, request key, and body when retrying the same request. The mapping is deterministic and does not use an execution ID, timestamp, or fresh UUID. A changed request must have a new event ID/version. Repeating an unchanged ID with a changed body can return `idempotency_conflict`; this remains incomplete.

This example has no durable deduplication store and makes no exactly-once claim. A production event handler must persist the intended request and key before dispatch and recover that same intent after timeouts. It must not issue a new key simply because the first attempt has an uncertain outcome. See [idempotency](https://www.sanctionskit.com/docs/idempotency).

## Adapt for a real onboarding system

Before connecting real people or organizations:

- Replace the synthetic manual source with an authenticated, validated event source. Define a durable event ID and immutable request record. The example does not implement an authenticated webhook.
- Map only known identity attributes; expand the deliberately small input validator for your supported subject types and date precision.
- Select production credentials, production coverage, and any approved policy your workspace requires. Update the sandbox-only result and evidence checks deliberately. Check source freshness, rights, and entity-type support; do not fall back to different coverage silently.
- Replace the four inspection nodes with access-controlled review and incomplete-request handling. Persist the full result/evidence, original event reference, and separate decision history. Define who may make the actual onboarding decision.
- Design explicit retries and recovery for incomplete requests while retaining the original key and body. Evidence-fetch recovery should reuse the existing screening ID; it need not create another screening.
- Set appropriate n8n execution-data retention, permissions, and logging for real subject details. Do not copy real screening data into fixtures or public issue reports.

Read [screenings](https://www.sanctionskit.com/docs/screenings), [error handling](https://www.sanctionskit.com/docs/errors), [retention](https://www.sanctionskit.com/docs/retention), and [pricing](https://www.sanctionskit.com/pricing) when adapting the template.

## Local checks

Node.js 24 or later; no dependencies needed for the core checks:

```sh
npm --prefix integrations/n8n run build
npm --prefix integrations/n8n test
```

The tests cover all ten fixture routes, deterministic keys, rejected inputs, unknown errors, cross-environment results, incomplete coverage, result/evidence identity, preserved item links, and credential-free exports. The JSON files are generated from `build.cjs`, `functions/review.cjs`, and synthetic fixtures; edit those sources and rebuild.

To additionally test the actual published node, point `SANCTIONSKIT_NODE_PACKAGE` at an unpacked **0.1.0** package and make its `n8n-workflow` dependency resolvable (for example, set `NODE_PATH` to an installed n8n runtime's `node_modules`). Run the same test command. This test intercepts the node's HTTP helper: its fake key is only an in-memory fixture marker and no hosted API requests occur.

For native import/export and offline execution with an existing n8n 2.41.4 installation:

```sh
N8N_BIN=/absolute/path/to/node_modules/n8n/bin/n8n \
  node integrations/n8n/tests/native-runtime.cjs
```

The native check creates isolated temporary n8n state, imports and exports both workflows, round-trips the export into separate clean state, and executes only the offline workflow. It needs permission to bind the local task-runner port. It never selects credentials or executes the sandbox workflow. Its report prints the temporary evidence directory.
