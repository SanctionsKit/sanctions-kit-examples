# SanctionsKit onboarding example for Windmill

Turn a fictional onboarding contact into a sanctions screening result with its evidence ready for review. This example uses the free SanctionsKit synthetic sandbox. It does not search live sanctions lists or approve anyone for onboarding.

The script makes two requests: `POST /screenings`, then `GET /results/{id}/evidence` using the returned ID. It checks that the evidence belongs to the same sandbox result and contact before returning it. Both potential matches and no-match results leave the review decision open.

[Create a free workspace](https://www.sanctionskit.com/signup) | [API quickstart](https://www.sanctionskit.com/docs/quickstart) | [Plans](https://www.sanctionskit.com/pricing)

## Set it up in Windmill

1. Create a SanctionsKit **sandbox** API key with `screenings:write` and `results:read`. Save it as a Windmill secret variable, for example `f/sanctionskit/sandbox_api_key`.
2. Add a resource type named `sanctionskit`. Use the `schema` object from [sanctionskit.resource-type.json](sanctionskit.resource-type.json).
3. Create a resource at `f/sanctionskit/sandbox`. Set its `api_key` field to the secret variable reference `$var:f/sanctionskit/sandbox_api_key`. A masked field alone is not a substitute for secret storage.
4. Create a TypeScript script using the **Bun** runtime. Paste [screen_onboarding.ts](f/sanctionskit/screen_onboarding.ts) into the editor. The script has no package dependencies. Select the resource you just created for its `sanctionskit` input.
5. Set `contact` to the `contact` object inside [fictional-input.json](fictional-input.json). Use `windmill:example-customer-001:v1` as `event_id` and set `synthetic` to `true`.
6. Run the script and inspect `screeningId`, `status`, `coverage`, `versions`, and `evidence`. The returned `review` object explains the next step. Find the same ID in sandbox screening history if you want to review it in SanctionsKit.

For a workspace already configured in the Windmill CLI, the source and metadata can be imported from this directory:

```sh
wmill resource-type push sanctionskit.resource-type.json sanctionskit
wmill script push f/sanctionskit/screen_onboarding.ts
```

These commands write to your selected Windmill workspace. Check the destination first. Create the secret and resource there, then run with the supplied input:

```sh
wmill script run f/sanctionskit/screen_onboarding --data @fictional-input.json
```

The example resource path is a reference, not a credential. No real API key belongs in this repository, the input JSON, a script argument saved as plain text, or a Hub submission. Windmill's [resource guide](https://www.windmill.dev/docs/core_concepts/resources_and_types) explains how resource inputs work.

## Errors and retries

The script makes one attempt per request. It stops on API errors, invalid responses, redirects, oversized responses, and evidence that does not match the screening. It never turns a failed request into `no_match`.

Keep `event_id` and the complete contact unchanged when retrying, including after a timeout or failed evidence fetch. A new or changed contact needs a new event ID. HTTP 409 means the request key conflicts with earlier input. For HTTP 429, wait for the reported retry delay before trying again. See [idempotency](https://www.sanctionskit.com/docs/idempotency) and [API errors](https://www.sanctionskit.com/docs/errors).

Each request has a 15-second deadline and a 1 MiB response limit. The API host and `sandbox@1` coverage are fixed in the script. Use only invented contacts. Production screening requires a separate integration review, a paid plan, production credentials, and appropriate coverage.

## Try the local test first

Node.js 24 or later is enough. No installation or API key is needed:

```sh
npm test
```

The tests run the actual script against a local HTTP server using an invalid test key. They cover both screening outcomes, same-result evidence, idempotency, redirects, API failures, invalid inputs, and response limits. No request reaches SanctionsKit or Windmill.

If Bun is installed, `bun tests/runtime-smoke.mjs` checks both outcomes in the script's target runtime with in-memory responses. These checks passed on Node.js 24.16.0 and Bun 1.4.2.

[synthetic-result.json](synthetic-result.json) is output from this local mock run. The response fixture comes from the public OpenAPI example, with the fictional contact and request aligned to this walkthrough. It is not a hosted execution receipt.

## Share the example

This folder contains the reusable source. A Windmill workspace execution and Hub submission have not been performed. To share on the Hub, publish the `sanctionskit` resource type and this script, and include only the fictional input and mock output until a real sandbox run has been checked. Approval and public visibility are separate steps in Windmill's [Hub process](https://www.windmill.dev/docs/misc/share_on_hub).

Maintained by SanctionsKit. Licensed under MIT.
