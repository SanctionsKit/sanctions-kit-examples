function fail(code, message) {
  return [null, { payload: {
    synthetic: true, ok: false, stage: "screening", code, message,
    reviewProduced: false
  }}];
}
if (!Number.isInteger(msg.statusCode) || msg.statusCode < 200 || msg.statusCode > 299) {
  return fail("SCREENING_HTTP_ERROR", "Screening did not return a successful HTTP response.");
}
if (!String(msg.headers?.["content-type"] || "").toLowerCase().includes("application/json") ||
    typeof msg.payload !== "string" || Buffer.byteLength(msg.payload, "utf8") > 1048576) {
  return fail("SCREENING_RESPONSE_INVALID", "Screening returned an unexpected response.");
}
let response;
try { response = JSON.parse(msg.payload); }
catch { return fail("SCREENING_RESPONSE_INVALID", "Screening returned invalid JSON."); }
const result = response?.data;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!result || typeof result !== "object" || Array.isArray(result) ||
    typeof result.id !== "string" || !uuid.test(result.id) ||
    result.environment !== "sandbox" || result.versions?.package !== "sandbox@1" ||
    !["potential_match", "no_match"].includes(result.status) ||
    !Array.isArray(result.matches) ||
    (result.status === "potential_match") !== (result.matches.length > 0) ||
    !Array.isArray(result.coverage) || !result.coverage.length ||
    result.coverage.some(source => source?.sourceId !== "sandbox-synthetic" ||
      typeof source.version !== "string" || typeof source.fresh !== "boolean") ||
    typeof result.disclaimer !== "string" || !result.disclaimer ||
    ["dataset", "matchingEngine", "policy"].some(k => typeof result.versions[k] !== "string" || !result.versions[k])) {
  return fail("SCREENING_RESPONSE_INVALID", "No complete synthetic screening result was returned.");
}
const key = env.get("SANCTIONSKIT_SANDBOX_KEY");
if (typeof key !== "string" || !key || key.length > 512 || /\s/.test(key)) {
  return fail("SANDBOX_KEY_REQUIRED", "The sandbox key is unavailable. No review record was produced.");
}
return [{
  _msgid: msg._msgid,
  screeningId: result.id,
  screeningResult: result,
  screeningRequest: msg.screeningRequest,
  eventId: msg.eventId,
  headers: { Authorization: "Bearer " + key, Accept: "application/json" },
  followRedirects: false,
  requestTimeout: 15000
}, null];
