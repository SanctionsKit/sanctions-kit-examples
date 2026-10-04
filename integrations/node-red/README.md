# SanctionsKit sandbox screening in Node-RED

Try a screening and evidence step with Node-RED's core nodes. The flow sends a fictional person to the SanctionsKit synthetic sandbox, then retrieves the evidence for that same result. No extra nodes or npm package are needed to use it.

The sandbox is free. Production screening uses separate paid access and an explicitly selected source package. This example stays on `sandbox@1` and does not make an onboarding decision.

## Run the example

1. Get a sandbox API key using the [API quickstart](https://www.sanctionskit.com/docs/quickstart).
2. Provide `SANCTIONSKIT_SANDBOX_KEY` and a stable `REQUEST_KEY` in your Node-RED process environment before starting Node-RED. For example, a request key can be `node-red-demo-001`. Keep the API key out of flow JSON and flow-level environment defaults.
3. Import `flow.json` into a new tab and deploy that tab. It uses a manual Inject node, with no schedule or startup trigger.
4. Click **Run fictional screening**. The input is fixed to Alex Morgan, an invented person with a fictional birth year of 1984. It creates a retained sandbox result with the reference `node-red-synthetic-example`.
5. Open **Synthetic review record** in the Debug sidebar. The result, evidence and review guidance are returned together. A failure goes to **Safe error summary** instead.

The flow uses `REQUEST_KEY` as its idempotency key and does not retry automatically. If a request times out, it may have completed on the API even though this flow did not receive the response. Keep the same request key and input when retrying that event. Use a new request key for a new test event, and restart Node-RED after changing its process environment.

## What the flow checks

The screening response must identify the sandbox environment, `sandbox@1`, synthetic coverage and a valid result ID. The evidence must identify that same result, status, source versions, fictional subject and reference. HTTP errors, redirects, unexpected response formats and mismatched evidence stop the review path.

Potential matches need review. A no-match result applies to the selected sources and matching rules; it is not clearance or an approval. Synthetic results say nothing about a real person.

The supplied Debug nodes show only the final output or a short error. Do not add a Debug node for an entire request message: request messages carry the authorization header. Node-RED administrators and anyone with editor access can inspect flows and run code, so use an instance whose access you control.

Requests use the fixed HTTPS API address, disable redirects and allow 15 seconds each. The flow rejects response bodies over 1 MiB after the HTTP node receives them. This is an example for a small synthetic response, not a streaming or bulk-data client.

The [results and evidence guide](https://www.sanctionskit.com/docs/evidence) explains retained inputs and evidence. Use a separate workflow and your own access, retention and review controls before working with production data.

## Check or change the example

`functions/` contains the Function node source. Run `npm run build` after editing those files to refresh `flow.json`.

For local tests:

```sh
npm install --ignore-scripts
npm run build
npm test
```

The development dependencies pin Node-RED 5.0.7 and its test helper 0.3.6. Use Node.js 22.9 or later. The tests execute native Function, Inject, HTTP Request and Catch nodes with local HTTP fixtures. They cover both screening statuses, HTTP failures, malformed responses, evidence identity, missing credentials, redirects and timeouts. The fixture bodies are synthetic test data. These tests do not execute the hosted SanctionsKit API.

Maintained by SanctionsKit.

[MIT license](LICENSE). Hosted API access is covered by [SanctionsKit's terms](https://www.sanctionskit.com/terms).
