// Inlined into the importable workflows by build.cjs. No network or filesystem access.
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

function mapEvent(event) {
  // This example intentionally accepts only its explicitly synthetic input shape.
  // Invalid input stops before the API node; it is never a no-match outcome.
  if (!isObject(event) || event.synthetic !== true || typeof event.eventId !== 'string' || !/^[A-Za-z0-9_:.-]{4,124}$/.test(event.eventId)) {
    throw new Error('Provide a synthetic event with a stable eventId of 4-124 allowed characters');
  }
  if (!isObject(event.subject) || typeof event.subject.name !== 'string' || event.subject.name.trim().length < 2 || event.subject.name.trim().length > 300 || event.subject.entityType !== 'person') {
    throw new Error('This example requires a fictional person with a name');
  }
  if (event.subject.birthDate !== undefined && (typeof event.subject.birthDate !== 'string' || !/^(?!0000)\d{4}$/.test(event.subject.birthDate))) {
    throw new Error('This example accepts only a known birth year, or omit birthDate');
  }
  const subject = { name: event.subject.name.trim(), entityType: 'person', identifiers: [] };
  if (event.subject.birthDate !== undefined) subject.birthDate = event.subject.birthDate;
  return {
    eventId: event.eventId,
    requestKey: 'n8n:' + event.eventId,
    request: { subject, package: 'sandbox@1', reference: event.eventId, retention: 'standard' },
    onboardingDecision: 'not_made',
    ...(event.fixtureCase ? { fixtureCase: event.fixtureCase } : {}),
  };
}

function failure(context, stage, errorCode, route = 'request_error') {
  return { ...context, route, stage, errorCode, onboardingDecision: 'not_made' };
}

function nodeFailure(response, context, stage) {
  if (!isObject(response) || !Object.hasOwn(response, 'error')) return null;
  // v0.1.0 continued errors expose a sanitized message, not an HTTP status/code object.
  // Recognize only that exact format. Unrecognized errors remain incomplete requests.
  const match = typeof response.error === 'string' && /^SanctionsKit request failed \(([a-z_]{1,80})\)$/.exec(response.error);
  const code = match ? match[1] : 'unclassified_node_error';
  return failure(context, stage, code, ['coverage_unavailable', 'stale_coverage'].includes(code) ? 'coverage_unavailable' : 'request_error');
}

function resultIssue(result) {
  if (!isObject(result) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.id || '') || result.environment !== 'sandbox' || !['potential_match', 'no_match'].includes(result.status) || !Array.isArray(result.matches) || typeof result.createdAt !== 'string' || !Number.isFinite(Date.parse(result.createdAt)) || typeof result.disclaimer !== 'string' || !result.disclaimer.trim() || !isObject(result.versions) || !['dataset', 'matchingEngine', 'policy'].every(k => typeof result.versions[k] === 'string' && result.versions[k])) {
    return 'invalid_result';
  }
  if (result.versions.package !== 'sandbox@1') return 'unexpected_coverage_package';
  if ((result.status === 'no_match' && result.matches.length !== 0) || (result.status === 'potential_match' && result.matches.length === 0)) return 'inconsistent_result';
  if (!result.matches.every(candidate => {
    if (!isObject(candidate) || !Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 100 || !Array.isArray(candidate.evidence) || !Array.isArray(candidate.conflicts) || !candidate.conflicts.every(value => typeof value === 'string')) return false;
    if (!candidate.evidence.every(value => isObject(value) && ['field', 'queryValue', 'sourceValue', 'method', 'explanation'].every(k => typeof value[k] === 'string') && Number.isFinite(value.contribution))) return false;
    const record = candidate.record;
    return isObject(record) && ['id', 'sourceId', 'authority', 'list', 'sourceUrl'].every(k => typeof record[k] === 'string') && ['person', 'organization', 'vessel', 'aircraft', 'other'].includes(record.entityType) && ['names', 'identifiers', 'birthDates', 'addresses', 'nationalities', 'designations'].every(k => Array.isArray(record[k])) && record.names.length > 0 && record.names.every(name => isObject(name) && typeof name.value === 'string' && ['primary', 'alias'].includes(name.kind)) && isObject(record.extensions);
  })) return 'invalid_candidate_evidence';
  if (!Array.isArray(result.coverage) || result.coverage.length === 0 || !result.coverage.every(c => isObject(c) && c.fresh === true && typeof c.sourceId === 'string' && c.sourceId && typeof c.version === 'string' && c.version && typeof c.retrievedAt === 'string' && Number.isFinite(Date.parse(c.retrievedAt)))) return 'coverage_unavailable';
  return null;
}

function classifyScreening(response, context) {
  const failed = nodeFailure(response, context, 'screening');
  if (failed) return failed;
  const issue = resultIssue(response);
  if (issue) return failure(context, 'screening', issue, issue === 'coverage_unavailable' ? issue : 'request_error');
  return { ...context, route: 'fetch_evidence', result: response, screeningId: response.id };
}

function finishEvidence(evidence, context) {
  const failed = nodeFailure(evidence, context, 'evidence');
  if (failed) return failed;
  if (!isObject(evidence) || evidence.format !== 'sanctionskit-evidence@1') return failure(context, 'evidence', 'invalid_evidence');
  const issue = resultIssue(evidence.result);
  if (issue) return failure(context, 'evidence', issue, issue === 'coverage_unavailable' ? issue : 'request_error');
  // Preserve the entire document, but compare all original result fields to the
  // result that triggered this fetch. Object key order is immaterial.
  if (!Object.keys(context.result).every(k => canonical(context.result[k]) === canonical(evidence.result[k]))) return failure(context, 'evidence', 'evidence_result_mismatch');
  if (evidence.retention !== 'standard' || evidence.retainedInputs !== true || !Object.hasOwn(evidence, 'expires_at') || !Object.hasOwn(evidence, 'replayLimit') || evidence.reference !== context.eventId || canonical(evidence.subject) !== canonical(context.request.subject) || canonical(evidence.request) !== canonical(context.request)) return failure(context, 'evidence', 'evidence_input_mismatch');
  return {
    ...context,
    route: context.result.status === 'potential_match' ? 'review_required' : 'no_match_policy_review',
    stage: 'evidence_complete',
    evidence,
    onboardingDecision: 'not_made',
  };
}

function outputIndex(route) {
  return ({ review_required: 0, no_match_policy_review: 1, request_error: 2, coverage_unavailable: 3 })[route] ?? 2;
}

module.exports = { mapEvent, classifyScreening, finishEvidence, outputIndex, resultIssue };
