const key = env.get("SANCTIONSKIT_SANDBOX_KEY");
if (typeof key !== "string" || !key || key.length > 512 || /\s/.test(key)) {
  return [null, { payload: {
    synthetic: true, ok: false, stage: "setup", code: "SANDBOX_KEY_REQUIRED",
    message: "Set SANCTIONSKIT_SANDBOX_KEY in the Node-RED process environment.",
    reviewProduced: false
  }}];
}
const eventId = env.get("REQUEST_KEY");
if (typeof eventId !== "string" || !/^[\w:.-]{8,128}$/.test(eventId)) {
  return [null, { payload: {
    synthetic: true, ok: false, stage: "setup", code: "REQUEST_KEY_REQUIRED",
    message: "Set REQUEST_KEY to a stable test-event ID before running the flow.",
    reviewProduced: false
  }}];
}
const request = {
  subject: { name: "Alex Morgan", entityType: "person", birthDate: "1984" },
  package: "sandbox@1",
  reference: "node-red-synthetic-example",
  retention: "standard"
};
return [{
  _msgid: msg._msgid,
  payload: JSON.stringify(request),
  headers: {
    Authorization: "Bearer " + key,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Idempotency-Key": eventId
  },
  followRedirects: false,
  requestTimeout: 15000,
  screeningRequest: request,
  eventId
}, null];
