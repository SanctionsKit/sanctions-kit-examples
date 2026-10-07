'use strict';

// Pure functions embedded into the importable Code nodes by build.cjs.
const KEY_PART = /^[A-Za-z0-9_-]{1,32}$/;
const UNAVAILABLE = new Set([
  'coverage_unavailable', 'stale_coverage', 'temporarily_unavailable',
  'usage_cap_reached', 'rate_limited', 'subscription_required',
  'production_screening_disabled', 'screening_policy_required',
  'screening_policy_unavailable', 'screening_policy_changed',
  'invalid_api_key', 'insufficient_scope', 'authentication_required',
]);
const ROW_ERROR = new Set(['invalid_request', 'idempotency_conflict', 'unsupported_entity_type']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function baseRow(row, index) {
  return {
    rowNumber: index + 1,
    supplierId: typeof row?.supplierId === 'string' ? row.supplierId : null,
    revision: Number.isSafeInteger(row?.revision) ? row.revision : null,
    rowKey: null,
    supplierName: typeof row?.name === 'string' ? row.name : null,
    rowStatus: 'unavailable', reason: 'not_attempted', attempted: false,
    businessDecision: 'not_decided', screeningId: null,
    screeningStatus: null, candidateCount: null,
    duplicateOfRow: null, result: null,
  };
}
function rowIdentity(listId, row) {
  if (!row || typeof row.supplierId !== 'string' || !KEY_PART.test(row.supplierId) ||
      !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('invalid_supplier_row');
  return `sk-supplier:${listId}:${row.supplierId}:${row.revision}`;
}
function requestFor(listId, row) {
  const rowKey = rowIdentity(listId, row);
  if (typeof row.name !== 'string' || row.name.trim().length < 2 || row.name.trim().length > 300 ||
      (row.country !== undefined && (typeof row.country !== 'string' || row.country.trim().length < 2 || row.country.trim().length > 100))) {
    throw new Error('invalid_supplier_row');
  }
  return {
    rowKey,
    body: {
      subject: { name: row.name.trim(), entityType: 'organization', identifiers: [],
        ...(row.country === undefined ? {} : {country: row.country.trim()}) },
      package: 'sandbox@1', reference: rowKey, retention: 'standard',
    },
  };
}
function prepare(input, mode) {
  if (!input || typeof input.listId !== 'string' || !KEY_PART.test(input.listId) || !Array.isArray(input.rows) || input.rows.length > 100 ||
      !Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 20 ||
      !['offline_fixture', 'sandbox_api'].includes(mode)) throw new Error('invalid_list_configuration');
  const state = {
    mode, listId: input.listId, maxAttempts: input.maxAttempts,
    attempts: 0, stopReason: null, queue: [], current: null,
    register: input.rows.map(baseRow),
  };
  const groups = new Map();
  input.rows.forEach((row, index) => {
    let rowKey;
    try { rowKey = rowIdentity(input.listId, row); }
    catch {
      Object.assign(state.register[index], {rowStatus: 'error', reason: 'invalid_supplier_row'});
      return;
    }
    state.register[index].rowKey = rowKey;
    const group = groups.get(rowKey) ?? [];
    try {
      const planned = {index, ...requestFor(input.listId, row)};
      if (mode === 'offline_fixture') planned.fixtureOutcome = row.fixtureOutcome;
      group.push(planned);
    } catch { group.push({index, rowKey, invalid: true}); }
    groups.set(rowKey, group);
  });
  for (const group of groups.values()) {
    if (group.some(row => row.invalid)) {
      for (const row of group) Object.assign(state.register[row.index], {rowStatus: 'error', reason: group.length > 1 ? 'duplicate_key_conflict' : 'invalid_supplier_row'});
      continue;
    }
    if (new Set(group.map(row => JSON.stringify(row.body))).size !== 1) {
      for (const row of group) Object.assign(state.register[row.index], {rowStatus: 'error', reason: 'duplicate_key_conflict'});
      continue;
    }
    state.queue.push(group[0]);
    for (const row of group.slice(1)) Object.assign(state.register[row.index], {
      rowStatus: 'duplicate', reason: 'identical_request_in_this_run', duplicateOfRow: group[0].index + 1,
    });
  }
  state.queue.sort((a, b) => a.index - b.index);
  return state;
}
function next(state) {
  if (state.current) throw new Error('previous_attempt_not_recorded');
  if (state.stopReason || state.attempts >= state.maxAttempts) {
    const reason = state.stopReason ? `run_stopped:${state.stopReason}` : 'run_attempt_limit';
    for (const row of state.queue) Object.assign(state.register[row.index], {rowStatus: 'unavailable', reason});
    state.queue = [];
  }
  state.current = state.queue.shift() ?? null;
  if (state.current) state.attempts += 1;
  return state;
}
function validMatch(match) {
  const r = match?.record;
  return match && typeof match === 'object' && !Array.isArray(match) &&
    Number.isFinite(match.score) && match.score >= 0 && match.score <= 100 &&
    Array.isArray(match.conflicts) && match.conflicts.every(c => typeof c === 'string') &&
    Array.isArray(match.evidence) && match.evidence.every(e => e &&
      ['field','queryValue','sourceValue','method','explanation'].every(k => typeof e[k] === 'string') && Number.isFinite(e.contribution)) &&
    r && typeof r === 'object' && !Array.isArray(r) &&
    ['id','sourceId','authority','list','sourceUrl'].every(k => typeof r[k] === 'string' && r[k].length > 0) &&
    r.sourceId === 'sandbox-synthetic' && ['person','organization','vessel','aircraft','other'].includes(r.entityType) &&
    Array.isArray(r.names) && r.names.length > 0 && r.names.every(n => n && typeof n.value === 'string' && n.value.length > 0 && ['primary','alias'].includes(n.kind)) &&
    ['identifiers','birthDates','addresses','nationalities','designations'].every(k => Array.isArray(r[k])) &&
    r.extensions && typeof r.extensions === 'object' && !Array.isArray(r.extensions);
}
function validResult(result) {
  return result && typeof result === 'object' && !Array.isArray(result) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(result.id ?? '') &&
    result.environment === 'sandbox' && ['potential_match', 'no_match'].includes(result.status) &&
    typeof result.createdAt === 'string' && Number.isFinite(Date.parse(result.createdAt)) &&
    Array.isArray(result.matches) && result.matches.every(validMatch) &&
    (result.status === 'potential_match' ? result.matches.length > 0 : result.matches.length === 0) &&
    Array.isArray(result.coverage) && result.coverage.length > 0 && result.coverage.every(c =>
      c && c.sourceId === 'sandbox-synthetic' && typeof c.version === 'string' && c.version.length > 0 &&
      c.fresh === true && typeof c.retrievedAt === 'string' && Number.isFinite(Date.parse(c.retrievedAt))) &&
    result.versions && ['dataset', 'matchingEngine', 'policy'].every(k => typeof result.versions[k] === 'string' && result.versions[k].length > 0) &&
    result.versions.package === 'sandbox@1' && typeof result.disclaimer === 'string' && result.disclaimer.length > 0;
}
function record(state, response) {
  if (!state.current) throw new Error('no_current_attempt');
  const row = state.register[state.current.index];
  row.attempted = true;
  // Node 0.1.0 emits a sanitized message, not an HTTP status or structured code.
  if (response && typeof response.error === 'string') {
    const code = /^SanctionsKit request failed \(([a-z_]{1,80})\)$/.exec(response.error)?.[1] ?? 'request_failed';
    row.rowStatus = UNAVAILABLE.has(code) ? 'unavailable' : 'error';
    row.reason = code;
    // Fail closed for shared access/coverage/allowance faults and unknown failures.
    if (!ROW_ERROR.has(code)) state.stopReason = code;
  } else if (!validResult(response)) {
    row.rowStatus = 'error';
    row.reason = 'invalid_or_unexpected_result';
    state.stopReason = row.reason;
  } else {
    row.rowStatus = response.status === 'potential_match' ? 'review' : 'no_match';
    row.reason = response.status === 'potential_match' ? 'candidates_need_review' : 'no_candidates_in_selected_coverage';
    row.screeningId = response.id;
    row.screeningStatus = response.status;
    row.candidateCount = response.matches.length;
    row.result = clone(response);
  }
  state.current = null;
  return state;
}
function finish(state) {
  if (state.current || state.queue.length) throw new Error('unfinished_register');
  return {
    format: 'sanctionskit-supplier-review-demo@1', executionMode: state.mode,
    listId: state.listId, rowCount: state.register.length,
    attempts: state.attempts, maxAttempts: state.maxAttempts, stopReason: state.stopReason,
    counts: state.register.reduce((counts, row) => { counts[row.rowStatus] = (counts[row.rowStatus] ?? 0) + 1; return counts; }, {}),
    storage: 'n8n_execution_output_only', evidenceBundleRetrieved: false,
    limitations: 'No supplier is approved or cleared. No match applies only to the selected synthetic coverage and supplied identity. This run output is not a durable external register or a retained evidence export.',
    rows: state.register,
  };
}
function fixtureResponse(current) {
  const outcome = current.fixtureOutcome;
  if (outcome !== 'potential_match' && outcome !== 'no_match') {
    return {error: outcome === 'network_error' ? 'SanctionsKit request failed' : `SanctionsKit request failed (${outcome})`};
  }
  return {
    id: `00000000-0000-4000-8000-${String(current.index + 1).padStart(12, '0')}`,
    environment: 'sandbox', status: outcome, createdAt: '2026-10-06T12:00:00.000Z',
    matches: outcome === 'no_match' ? [] : [{
      record: {id: 'synthetic-supplier-001', sourceId: 'sandbox-synthetic', entityType: 'organization',
        authority: 'SanctionsKit synthetic fixture', list: 'Local demonstration only',
        names: [{value: current.body.subject.name, kind: 'primary'}], identifiers: [],
        birthDates: [], addresses: [], nationalities: [], designations: [], extensions: {},
        sourceUrl: 'https://www.sanctionskit.com/docs/onboarding'},
      score: 100,
      evidence: [{field: 'name', queryValue: current.body.subject.name, sourceValue: current.body.subject.name,
        method: 'fixture', contribution: 100, explanation: 'Invented local fixture; not an API screening or real designation.'}],
      conflicts: [],
    }],
    coverage: [{sourceId: 'sandbox-synthetic', version: '1', retrievedAt: '2026-10-06T12:00:00.000Z', fresh: true}],
    versions: {dataset: 'sandbox-synthetic-v1', matchingEngine: 'deterministic-1.1.1', policy: 'review-1.1.0', package: 'sandbox@1'},
    disclaimer: 'Synthetic fixture only. Potential matches require review. No match is limited to selected sources and supplied identity; it is not legal clearance. Scores are not probabilities of wrongdoing.',
  };
}
function runOffline(input) {
  let state = prepare(input, 'offline_fixture');
  while (next(state).current) state = record(state, fixtureResponse(state.current));
  return finish(state);
}
module.exports = {prepare, next, record, finish, fixtureResponse, runOffline, requestFor, validResult};
