// Pure fixtures. build.cjs inlines these only into the explicitly OFFLINE workflow.
function fixtureScreening(context, baseEvidence) {
  const name = context.fixtureCase;
  if (['coverage_unavailable', 'stale_coverage', 'invalid_api_key', 'idempotency_conflict'].includes(name)) return { error: `SanctionsKit request failed (${name})` };
  if (name === 'unknown_error_shape') return { error: { code: 'coverage_unavailable' } };
  const result = JSON.parse(JSON.stringify(baseEvidence.result));
  if (name.startsWith('no_match')) { result.status = 'no_match'; result.matches = []; }
  if (name === 'no_match_missing_coverage') result.coverage = [];
  return result;
}

function fixtureEvidence(context, baseEvidence) {
  if (context.fixtureCase === 'evidence_error') return { error: 'SanctionsKit request failed (result_expired)' };
  const evidence = JSON.parse(JSON.stringify(baseEvidence));
  evidence.result = JSON.parse(JSON.stringify(context.result));
  evidence.subject = context.request.subject;
  evidence.reference = context.eventId;
  evidence.request = context.request;
  if (context.fixtureCase === 'evidence_wrong_id') evidence.result.id = '00000000-0000-4000-8000-000000000099';
  return evidence;
}

module.exports = { fixtureScreening, fixtureEvidence };
