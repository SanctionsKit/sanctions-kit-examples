import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { main } from "../f/sanctionskit/screen_onboarding.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/synthetic-evidence.json", import.meta.url)),
);
const input = JSON.parse(
  readFileSync(new URL("../fictional-input.json", import.meta.url)),
);
const originalFetch = globalThis.fetch;
try {
  for (const status of ["potential_match", "no_match"]) {
    const evidence = structuredClone(fixture);
    evidence.result.status = status;
    if (status === "no_match") evidence.result.matches = [];
    const seen = [];
    globalThis.fetch = async (url, options) => {
      seen.push({ url, options });
      return new Response(
        JSON.stringify(
          seen.length === 1 ? { data: evidence.result } : evidence,
        ),
        {
          status: seen.length === 1 ? 201 : 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const output = await main(
      { api_key: "fictional-local-test-key-never-valid" },
      input.contact,
      input.event_id,
      true,
    );
    assert.equal(output.status, status);
    assert.equal(output.review.decision, "not_made");
    assert.equal(output.evidence.result.id, output.screeningId);
    assert.equal(seen.length, 2);
    assert.ok(seen[1].url.endsWith(`/results/${output.screeningId}/evidence`));
  }
  console.log(
    "Two synthetic main-function scenarios passed. No external requests were made.",
  );
} finally {
  globalThis.fetch = originalFetch;
}
