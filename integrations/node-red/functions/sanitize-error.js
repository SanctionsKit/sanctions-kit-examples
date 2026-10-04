const stage = {
  "sk-prepare": "setup",
  "sk-screen": "screening",
  "sk-evidence-request": "screening",
  "sk-evidence": "evidence",
  "sk-review": "evidence"
}[msg.error?.source?.id] || "workflow";
return { payload: {
  synthetic: true, ok: false, stage, code: "REQUEST_FAILED",
  message: "The request did not complete. No review record was produced.",
  reviewProduced: false
}};
