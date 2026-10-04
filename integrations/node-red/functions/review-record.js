function fail(code, message) {
  return [null, { payload: {
    synthetic: true, ok: false, stage: "evidence", code, message,
    reviewProduced: false
  }}];
}
if (!Number.isInteger(msg.statusCode) || msg.statusCode < 200 || msg.statusCode > 299) {
  return fail("EVIDENCE_HTTP_ERROR", "Evidence did not return a successful HTTP response.");
}
if (!String(msg.headers?.["content-type"] || "").toLowerCase().includes("application/json") ||
    typeof msg.payload !== "string" || Buffer.byteLength(msg.payload, "utf8") > 1048576) {
  return fail("EVIDENCE_RESPONSE_INVALID", "Evidence returned an unexpected response.");
}
let evidence;
try { evidence = JSON.parse(msg.payload); }
catch { return fail("EVIDENCE_RESPONSE_INVALID", "Evidence returned invalid JSON."); }
const saved = evidence?.result;
const original = msg.screeningResult;
const request = msg.screeningRequest;
const coverage = value => Array.isArray(value) ? value.map(source =>
  [source?.sourceId, source?.version, source?.retrievedAt, source?.fresh]
).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : null;
if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) ||
    evidence.format !== "sanctionskit-evidence@1" ||
    evidence.retention !== "standard" || evidence.retainedInputs !== true ||
    !saved || !original || !request ||
    saved.id !== original.id || saved.id !== msg.screeningId ||
    saved.status !== original.status || saved.environment !== "sandbox" ||
    ["package", "dataset", "matchingEngine", "policy"].some(k => saved.versions?.[k] !== original.versions[k]) ||
    JSON.stringify(coverage(saved.coverage)) !== JSON.stringify(coverage(original.coverage)) ||
    !Array.isArray(saved.matches) ||
    (saved.status === "potential_match") !== (saved.matches.length > 0) ||
    typeof saved.disclaimer !== "string" || !saved.disclaimer ||
    evidence.reference !== request.reference ||
    evidence.subject?.name !== request.subject.name ||
    evidence.subject?.entityType !== request.subject.entityType ||
    evidence.subject?.birthDate !== request.subject.birthDate) {
  return fail("EVIDENCE_IDENTITY_INVALID", "Evidence does not match this completed synthetic screening.");
}
return [{ payload: {
  synthetic: true,
  ok: true,
  screeningId: saved.id,
  eventId: msg.eventId,
  status: saved.status,
  review: {
    required: true,
    decision: "not_made",
    nextStep: saved.status === "potential_match"
      ? "Compare the candidate records and evidence. A name match is not an onboarding decision."
      : "Review the selected coverage and your onboarding requirements. No match is not clearance."
  },
  result: saved,
  evidence
}}, null];
