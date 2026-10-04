const fs = require("node:fs");
const path = require("node:path");
const tab = "sk-sandbox";
const fn = (id, name, file, x, y, wires, outputs = 2) => ({
  id, type: "function", z: tab, name,
  func: fs.readFileSync(path.join(__dirname, "functions", file), "utf8"),
  outputs, timeout: 0, noerr: 0, initialize: "", finalize: "", libs: [], x, y, wires
});
const request = (id, name, method, url, x, y, wires) => ({
  id, type: "http request", z: tab, name, method, ret: "txt", paytoqs: "ignore",
  url, tls: "", persist: false, proxy: "", insecureHTTPParser: false,
  authType: "", senderr: true, headers: [], x, y, wires
});
const debug = (id, name, x, y) => ({
  id, type: "debug", z: tab, name, active: true, tosidebar: true,
  console: false, tostatus: false, complete: "payload", targetType: "msg",
  statusVal: "", statusType: "auto", x, y, wires: []
});
const flow = [
  { id: tab, type: "tab", label: "SanctionsKit synthetic screening", disabled: false,
    info: "Company example from SanctionsKit. Fixed fictional input, sandbox@1 only. Set SANCTIONSKIT_SANDBOX_KEY and REQUEST_KEY outside the flow JSON. Run manually. Free synthetic sandbox; paid production access is separate. No screening result is an approval decision.", env: [] },
  { id: "sk-info", type: "comment", z: tab, name: "Manual synthetic example. Set the sandbox key in the process environment.",
    info: "Import the entire tab. Set REQUEST_KEY to a stable test-event ID; keep it unchanged when retrying the same input. This example makes two API requests after you click the manual trigger. Do not use real customer details. Output is limited to the supplied debug nodes; do not debug whole request messages because they contain the authorization header. Docs: https://www.sanctionskit.com/docs/quickstart", x: 350, y: 60, wires: [] },
  { id: "sk-run", type: "inject", z: tab, name: "Run fictional screening", props: [{ p: "payload" }],
    repeat: "", crontab: "", once: false, onceDelay: 0.1, topic: "", payload: "", payloadType: "date",
    x: 140, y: 140, wires: [["sk-prepare"]] },
  fn("sk-prepare", "Prepare synthetic request", "prepare-screening.js", 400, 140, [["sk-screen"], ["sk-errors"]]),
  request("sk-screen", "Screen in sandbox", "POST", "https://www.sanctionskit.com/api/v1/screenings", 670, 140, [["sk-evidence-request"]]),
  fn("sk-evidence-request", "Validate result; request its evidence", "prepare-evidence.js", 360, 240, [["sk-evidence"], ["sk-errors"]]),
  request("sk-evidence", "Get evidence for this result", "GET", "https://www.sanctionskit.com/api/v1/results/{{screeningId}}/evidence", 670, 240, [["sk-review"]]),
  fn("sk-review", "Validate evidence; create review record", "review-record.js", 380, 340, [["sk-output"], ["sk-errors"]]),
  debug("sk-output", "Synthetic review record", 720, 340),
  { id: "sk-catch", type: "catch", z: tab, name: "Catch request failures",
    scope: ["sk-prepare", "sk-screen", "sk-evidence-request", "sk-evidence", "sk-review"],
    uncaught: false, x: 160, y: 440, wires: [["sk-sanitize"]] },
  fn("sk-sanitize", "Remove request details", "sanitize-error.js", 420, 440, [["sk-errors"]], 1),
  debug("sk-errors", "Safe error summary", 710, 440)
];
fs.writeFileSync(path.join(__dirname, "flow.json"), JSON.stringify(flow, null, 2) + "\n");
