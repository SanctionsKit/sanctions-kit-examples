import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { main } from "../f/sanctionskit/screen_onboarding.ts";

const evidenceFixture = JSON.parse(
  readFileSync(new URL("./fixtures/synthetic-evidence.json", import.meta.url)),
);
const input = JSON.parse(
  readFileSync(new URL("../fictional-input.json", import.meta.url)),
);
const credentials = { api_key: "fictional-local-test-key-never-valid" };
const run = (changes = {}) => {
  const value = { ...input, sanctionskit: credentials, ...changes };
  return main(
    value.sanctionskit,
    value.contact,
    value.event_id,
    value.synthetic,
  );
};
const json = (value, status = 200) => ({ status, body: JSON.stringify(value) });
const successful = () => [
  json({ data: evidenceFixture.result }, 201),
  json(evidenceFixture),
];

async function withServer(t, responses, check) {
  const requests = [];
  let unexpected;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      path: req.url,
      method: req.method,
      headers: req.headers,
      body,
    });
    const step = responses[requests.length - 1];
    if (!step) unexpected = `Unexpected request to ${req.url}`;
    res.writeHead(step?.status ?? 500, {
      "Content-Type": "application/json",
      ...step?.headers,
    });
    res.end(step?.body ?? "{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  const mock = t.mock.method(globalThis, "fetch", (url, options) => {
    assert.ok(url.startsWith("https://www.sanctionskit.com/api/v1/"));
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return realFetch(
      url.replace("https://www.sanctionskit.com", origin),
      options,
    );
  });
  try {
    await check(requests, origin);
    assert.equal(unexpected, undefined);
  } finally {
    mock.mock.restore();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("screens the fictional contact and retrieves evidence for that exact result", async (t) => {
  await withServer(t, successful(), async (requests) => {
    const result = await run();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].path, "/api/v1/screenings");
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].headers["idempotency-key"], input.event_id);
    assert.deepEqual(JSON.parse(requests[0].body), evidenceFixture.request);
    assert.equal(requests[1].method, "GET");
    assert.equal(
      requests[1].path,
      `/api/v1/results/${result.screeningId}/evidence`,
    );
    for (const request of requests)
      assert.equal(
        request.headers.authorization,
        `Bearer ${credentials.api_key}`,
      );
    assert.equal(result.review.required, true);
    assert.equal(result.review.decision, "not_made");
    assert.equal(result.status, "potential_match");
    assert.deepEqual(result.coverage, evidenceFixture.result.coverage);
    assert.deepEqual(result.versions, evidenceFixture.result.versions);
    assert.deepEqual(result.evidence, evidenceFixture);
    assert.equal(JSON.stringify(result).includes(credentials.api_key), false);
    if (process.env.WRITE_SYNTHETIC_RESULT === "true") {
      writeFileSync(
        new URL("../synthetic-result.json", import.meta.url),
        JSON.stringify(result, null, 2) + "\n",
      );
    }
  });
});

test("no_match keeps review open and does not become an onboarding approval", async (t) => {
  const evidence = structuredClone(evidenceFixture);
  evidence.result.status = "no_match";
  evidence.result.matches = [];
  await withServer(
    t,
    [json({ data: evidence.result }, 201), json(evidence)],
    async () => {
      const result = await run();
      assert.equal(result.status, "no_match");
      assert.equal(result.review.required, true);
      assert.equal(result.review.decision, "not_made");
      assert.match(result.review.nextStep, /not clearance/);
    },
  );
});

test("a repeated event reuses the exact body and idempotency key", async (t) => {
  await withServer(t, [...successful(), ...successful()], async (requests) => {
    const first = await run();
    const second = await run();
    assert.equal(first.screeningId, second.screeningId);
    assert.equal(
      requests[0].headers["idempotency-key"],
      requests[2].headers["idempotency-key"],
    );
    assert.equal(requests[0].body, requests[2].body);
  });
});

for (const [name, changes] of [
  ["synthetic confirmation", { synthetic: false }],
  ["credential", { sanctionskit: { api_key: "bad\nkey" } }],
  ["contact", { contact: null }],
  ["name", { contact: { ...input.contact, name: " " } }],
  ["reference", { contact: { ...input.contact, reference: "a".repeat(161) } }],
  ["birth year", { contact: { ...input.contact, birth_year: "0000" } }],
  ["event ID length", { event_id: "short" }],
  ["event ID characters", { event_id: "event/contains/slash" }],
]) {
  test(`invalid ${name} stops before any network request`, async (t) => {
    const mock = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Network must not run");
    });
    await assert.rejects(run(changes));
    assert.equal(mock.mock.callCount(), 0);
  });
}

for (const status of [401, 403, 409, 429, 500]) {
  test(`HTTP ${status} fails without fetching evidence, retrying, or echoing the error body`, async (t) => {
    await withServer(
      t,
      [json({ error: { message: credentials.api_key } }, status)],
      async (requests) => {
        await assert.rejects(run(), (error) => {
          assert.match(error.message, new RegExp(`HTTP ${status}`));
          assert.equal(error.message.includes(credentials.api_key), false);
          return true;
        });
        assert.equal(requests.length, 1);
      },
    );
  });
}

test("failed evidence retrieval does not return a partial review result", async (t) => {
  await withServer(
    t,
    [successful()[0], json({ error: { code: "not_found" } }, 404)],
    async (requests) => {
      await assert.rejects(run(), /HTTP 404/);
      assert.equal(requests.length, 2);
    },
  );
});

test("a numeric Retry-After is retained without returning the error payload", async (t) => {
  const response = {
    ...json({ error: { message: credentials.api_key } }, 429),
    headers: { "Retry-After": "12" },
  };
  await withServer(t, [response], async () =>
    assert.rejects(run(), /Retry after 12 seconds/),
  );
});

for (const [name, mutate] of [
  [
    "different screening ID",
    (e) => {
      e.result.id = "00000000-0000-4000-8000-000000000099";
    },
  ],
  [
    "different reference",
    (e) => {
      e.reference = "another-contact";
    },
  ],
  [
    "different subject",
    (e) => {
      e.subject.name = "Someone Else Example";
    },
  ],
  [
    "different birth year",
    (e) => {
      e.subject.birthDate = "1990";
    },
  ],
  [
    "production result",
    (e) => {
      e.result.environment = "production";
    },
  ],
  [
    "different package",
    (e) => {
      e.result.versions.package = "other@1";
    },
  ],
  [
    "missing retained inputs",
    (e) => {
      e.retainedInputs = false;
    },
  ],
  [
    "different result status",
    (e) => {
      e.result.status = "no_match";
      e.result.matches = [];
    },
  ],
]) {
  test(`${name} in evidence cannot be passed to review`, async (t) => {
    const evidence = structuredClone(evidenceFixture);
    mutate(evidence);
    await withServer(t, [successful()[0], json(evidence)], async () =>
      assert.rejects(run()),
    );
  });
}

for (const [name, value] of [
  ["missing screening envelope", {}],
  [
    "unsafe result ID",
    { data: { ...evidenceFixture.result, id: "../another-result" } },
  ],
  [
    "production screening",
    { data: { ...evidenceFixture.result, environment: "production" } },
  ],
  [
    "unknown status",
    { data: { ...evidenceFixture.result, status: "processing" } },
  ],
  ["missing coverage", { data: { ...evidenceFixture.result, coverage: [] } }],
  [
    "inconsistent no-match",
    { data: { ...evidenceFixture.result, status: "no_match" } },
  ],
]) {
  test(`${name} prevents the evidence request`, async (t) => {
    await withServer(t, [json(value, 201)], async (requests) => {
      await assert.rejects(run());
      assert.equal(requests.length, 1);
    });
  });
}

test("evidence uses the documented raw envelope, not a data wrapper", async (t) => {
  await withServer(
    t,
    [successful()[0], json({ data: evidenceFixture })],
    async () => assert.rejects(run()),
  );
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`HTTP ${status} never forwards the credential through a redirect`, async (t) => {
    await withServer(
      t,
      [{ status, headers: { Location: "/leaked-key" }, body: "" }],
      async (requests) => {
        await assert.rejects(run(), /did not complete/);
        assert.equal(requests.length, 1);
      },
    );
  });
}

test("malformed JSON and wrong media types fail closed", async (t) => {
  for (const response of [
    { status: 201, body: "{bad json" },
    { ...successful()[0], headers: { "Content-Type": "text/html" } },
  ])
    await withServer(t, [response], async () => assert.rejects(run()));
});

test("oversized evidence is rejected before returning a review result", async (t) => {
  const oversized = { ...evidenceFixture, extra: "x".repeat(1024 * 1024) };
  await withServer(t, [successful()[0], json(oversized)], async () =>
    assert.rejects(run(), /too large/),
  );
});

test("network failure keeps a stable retry instruction and does not expose transport details", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error(credentials.api_key);
  });
  await assert.rejects(run(), (error) => {
    assert.match(error.message, /same event ID and contact/);
    assert.equal(error.message.includes(credentials.api_key), false);
    return true;
  });
});
