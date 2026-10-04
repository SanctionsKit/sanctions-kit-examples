const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const path = require("node:path");
const { test } = require("node:test");
const helper = require("node-red-node-test-helper");
const functions = require("@node-red/nodes/core/function/10-function.js");
const httpRequest = require("@node-red/nodes/core/network/21-httprequest.js");
const inject = require("@node-red/nodes/core/common/20-inject.js");
const comment = require("@node-red/nodes/core/common/90-comment.js");

helper.init(require.resolve("node-red"), {
  functionExternalModules: false,
  logging: { console: { level: "off" } }
});
const flow = JSON.parse(readFileSync(path.join(__dirname, "../flow.json")));
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures/evidence.json")));
const key = "fictional-node-red-test-key-never-valid";
const json = (body, status = 200, headers = {}) => ({
  body: JSON.stringify(body), status, headers: { "content-type": "application/json", ...headers }
});
const success = () => [json({ data: fixture.result }, 201), json(fixture)];
const clone = value => JSON.parse(JSON.stringify(value));

async function run(responses, options = {}) {
  const requests = [];
  const events = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, headers: req.headers, body });
    const step = responses[requests.length - 1];
    if (step?.disconnect) return req.socket.destroy();
    if (step?.delay) await new Promise(resolve => setTimeout(resolve, step.delay));
    if (res.destroyed) return;
    res.writeHead(step?.status || 500, step?.headers || { "content-type": "application/json" });
    res.end(step?.body || "{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const loaded = clone(flow);
  // Only the native HTTP-node URL origin is changed for local fixture execution.
  // The distributed artifact always retains its fixed HTTPS company origin.
  for (const node of loaded) {
    if (node.type === "http request") {
      assert.ok(node.url.startsWith("https://www.sanctionskit.com/api/v1/"));
      node.url = node.url.replace("https://www.sanctionskit.com", origin);
    }
    if (node.type === "debug") node.type = "helper";
  }
  if (options.timeout) {
    // Shorten only the native request timeout for a bounded timeout test.
    for (const node of loaded.filter(n => n.type === "function")) {
      node.func = node.func.replaceAll("requestTimeout: 15000", `requestTimeout: ${options.timeout}`);
    }
  }
  if (options.key === null) delete process.env.SANCTIONSKIT_SANDBOX_KEY;
  else process.env.SANCTIONSKIT_SANDBOX_KEY = options.key || key;
  if (options.requestKey === null) delete process.env.REQUEST_KEY;
  else process.env.REQUEST_KEY = options.requestKey || "node-red-fictional-event-001";
  try {
    await new Promise((resolve, reject) => helper.startServer(err => err ? reject(err) : resolve()));
    await helper.load([functions, httpRequest, inject, comment], loaded);
    assert.ok(helper.getNode("sk-output"), "Native flow must load its output node");
    const result = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Flow did not reach a terminal output")), 5000);
      for (const id of ["sk-output", "sk-errors"]) {
        helper.getNode(id).on("input", msg => {
          events.push({ id, msg });
          clearTimeout(deadline);
          resolve({ id, msg });
        });
      }
      helper.getNode(options.direct ? "sk-prepare" : "sk-run").receive(options.message || {});
    });
    // Allow an accidental second terminal output or retry to become visible.
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(events.length, 1, "Exactly one terminal path should run");
    assert.equal(JSON.stringify(result.msg).includes(key), false, "Output must not contain the key");
    assert.equal(Object.hasOwn(result.msg, "headers"), false);
    assert.equal(Object.hasOwn(result.msg, "screeningRequest"), false);
    return { ...result, requests };
  } finally {
    await helper.unload();
    await new Promise(resolve => helper.stopServer(resolve));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    delete process.env.SANCTIONSKIT_SANDBOX_KEY;
    delete process.env.REQUEST_KEY;
  }
}

test("export uses core nodes, safe debug fields and a manual trigger", () => {
  const ids = new Set(flow.map(n => n.id));
  const core = new Set(["tab", "comment", "inject", "function", "http request", "debug", "catch"]);
  for (const n of flow) {
    assert.ok(core.has(n.type));
    for (const output of n.wires || []) for (const id of output) assert.ok(ids.has(id));
    if (n.type === "function") {
      const file = {
        "sk-prepare": "prepare-screening.js", "sk-evidence-request": "prepare-evidence.js",
        "sk-review": "review-record.js", "sk-sanitize": "sanitize-error.js"
      }[n.id];
      assert.equal(n.func, readFileSync(path.join(__dirname, "../functions", file), "utf8"));
    }
    if (n.type === "debug") {
      assert.equal(n.complete, "payload");
      assert.equal(n.console, false);
    }
    if (n.type === "http request") {
      assert.equal(n.senderr, true);
      assert.ok(n.url.startsWith("https://www.sanctionskit.com/api/v1/"));
      assert.deepEqual(n.headers, []);
    }
  }
  const trigger = flow.find(n => n.type === "inject");
  assert.equal(trigger.once, false);
  assert.equal(trigger.repeat, "");
  assert.equal(trigger.crontab, "");
  assert.deepEqual(flow[0].env, []);
});

test("native flow screens the fixture and gets evidence for the same result", async () => {
  const result = await run(success());
  assert.equal(result.id, "sk-output");
  assert.equal(result.msg.payload.ok, true);
  assert.equal(result.msg.payload.status, "potential_match");
  assert.equal(result.msg.payload.review.decision, "not_made");
  assert.equal(result.msg.payload.review.required, true);
  assert.deepEqual(clone(result.msg.payload.evidence), fixture);
  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0].method, "POST");
  assert.equal(result.requests[0].path, "/api/v1/screenings");
  assert.deepEqual(JSON.parse(result.requests[0].body), fixture.request);
  assert.equal(result.requests[0].headers["idempotency-key"], result.msg.payload.eventId);
  assert.equal(result.msg.payload.eventId, "node-red-fictional-event-001");
  assert.equal(result.requests[1].method, "GET");
  assert.equal(result.requests[1].body, "");
  assert.equal(result.requests[1].path, `/api/v1/results/${fixture.result.id}/evidence`);
  assert.equal(result.requests[1].headers["idempotency-key"], undefined);
  for (const req of result.requests) assert.equal(req.headers.authorization, `Bearer ${key}`);
});

test("no-match stays a review record, never an approval", async () => {
  const e = clone(fixture); e.result.status = "no_match"; e.result.matches = [];
  const result = await run([json({ data: e.result }), json(e)]);
  assert.equal(result.id, "sk-output");
  assert.equal(result.msg.payload.status, "no_match");
  assert.equal(result.msg.payload.review.required, true);
  assert.equal(result.msg.payload.review.decision, "not_made");
  assert.match(result.msg.payload.review.nextStep, /not clearance/);
});

test("missing key stops before any network request", async () => {
  const result = await run([], { key: null });
  assert.equal(result.id, "sk-errors");
  assert.equal(result.msg.payload.code, "SANDBOX_KEY_REQUIRED");
  assert.equal(result.requests.length, 0);
});

test("missing request key stops before any network request", async () => {
  const result = await run([], { requestKey: null });
  assert.equal(result.msg.payload.code, "REQUEST_KEY_REQUIRED");
  assert.equal(result.requests.length, 0);
});

test("manual reruns keep the supplied request key and fictional input", async () => {
  const first = await run(success(), { requestKey: "node-red-stable-retry-001" });
  const second = await run(success(), { requestKey: "node-red-stable-retry-001" });
  assert.equal(first.requests[0].headers["idempotency-key"], second.requests[0].headers["idempotency-key"]);
  assert.equal(first.requests[0].body, second.requests[0].body);
  assert.equal(first.requests[0].headers["idempotency-key"], "node-red-stable-retry-001");
});

test("injected URL, header and TLS overrides are discarded", async () => {
  const result = await run(success(), { direct: true, message: {
    _msgid: "fixed-test-event", url: "http://untrusted.invalid/", headers: { Authorization: "wrong" },
    followRedirects: true, rejectUnauthorized: false, cookies: { session: "unwanted" }, payload: "real input is ignored"
  }});
  assert.equal(result.id, "sk-output");
  assert.equal(result.requests.length, 2);
  assert.deepEqual(JSON.parse(result.requests[0].body), fixture.request);
  for (const req of result.requests) assert.equal(req.headers.cookie, undefined);
  assert.equal(result.requests[0].headers["idempotency-key"], "node-red-fictional-event-001");
});

for (const status of [301, 400, 401, 403, 429, 500]) {
  test(`screening HTTP ${status} never becomes a result or triggers evidence`, async () => {
    const result = await run([json({ error: { message: key } }, status, { location: "/redirect-target" })]);
    assert.equal(result.id, "sk-errors");
    assert.equal(result.msg.payload.code, "SCREENING_HTTP_ERROR");
    assert.equal(result.requests.length, 1);
  });
}

for (const status of [302, 401, 404, 429, 500]) {
  test(`evidence HTTP ${status} stops the review path`, async () => {
    const result = await run([success()[0], json({ error: { message: key } }, status, { location: "/redirect-target" })]);
    assert.equal(result.id, "sk-errors");
    assert.equal(result.msg.payload.code, "EVIDENCE_HTTP_ERROR");
    assert.equal(result.requests.length, 2);
  });
}

for (const [name, change] of [
  ["production environment", r => { r.environment = "production"; }],
  ["wrong package", r => { r.versions.package = "unselected@1"; }],
  ["unsafe result ID", r => { r.id = "../other"; }],
  ["missing result ID", r => { delete r.id; }],
  ["unknown status", r => { r.status = "approved"; }],
  ["empty coverage", r => { r.coverage = []; }],
  ["non-synthetic coverage", r => { r.coverage[0].sourceId = "unselected-source"; }],
  ["missing policy version", r => { delete r.versions.policy; }],
  ["no-match with matches", r => { r.status = "no_match"; }],
  ["potential-match without matches", r => { r.matches = []; }]
]) {
  test(`rejects screening response with ${name}`, async () => {
    const r = clone(fixture.result); change(r);
    const result = await run([json({ data: r })]);
    assert.equal(result.msg.payload.code, "SCREENING_RESPONSE_INVALID");
    assert.equal(result.requests.length, 1);
  });
}

for (const [name, change] of [
  ["wrong ID", e => { e.result.id = "00000000-0000-4000-8000-000000000099"; }],
  ["wrong format", e => { e.format = "unknown"; }],
  ["wrong subject", e => { e.subject.name = "Different Example"; }],
  ["wrong birth year", e => { e.subject.birthDate = "1990"; }],
  ["wrong reference", e => { e.reference = "different-event"; }],
  ["wrong environment", e => { e.result.environment = "production"; }],
  ["wrong dataset", e => { e.result.versions.dataset = "changed"; }],
  ["changed coverage", e => { e.result.coverage[0].version = "changed"; }],
  ["missing retained inputs", e => { e.retainedInputs = false; }],
  ["minimal retention", e => { e.retention = "minimal"; }],
  ["changed status", e => { e.result.status = "no_match"; e.result.matches = []; }]
]) {
  test(`rejects evidence with ${name}`, async () => {
    const e = clone(fixture); change(e);
    const result = await run([success()[0], json(e)]);
    assert.equal(result.msg.payload.code, "EVIDENCE_IDENTITY_INVALID");
    assert.equal(result.requests.length, 2);
  });
}

for (const stage of ["screening", "evidence"]) {
  for (const [name, step] of [
    ["invalid JSON", { status: 200, headers: { "content-type": "application/json" }, body: "{" }],
    ["wrong content type", { status: 200, headers: { "content-type": "text/html" }, body: "<html>Unexpected</html>" }],
    ["oversized JSON", json({ padding: "x".repeat(1048576) })],
    ["disconnect", { disconnect: true }]
  ]) {
    test(`${stage} ${name} has only a safe error output`, async () => {
      const result = await run(stage === "screening" ? [step] : [success()[0], step]);
      assert.equal(result.id, "sk-errors");
      assert.equal(result.msg.payload.ok, false);
      assert.equal(result.msg.payload.reviewProduced, false);
      assert.equal(result.requests.length, stage === "screening" ? 1 : 2);
    });
  }
}

test("native HTTP timeout is caught once without retries or a review record", async () => {
  const result = await run([{ ...success()[0], delay: 250 }], { timeout: 50 });
  assert.equal(result.id, "sk-errors");
  assert.equal(result.msg.payload.code, "REQUEST_FAILED");
  assert.equal(result.requests.length, 1);
});
