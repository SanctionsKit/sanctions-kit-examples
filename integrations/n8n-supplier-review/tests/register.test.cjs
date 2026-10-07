'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {prepare, next, record, finish, runOffline, fixtureResponse, requestFor} = require('../functions/register.cjs');
const fixture = require('../fixtures/suppliers.json');
const copy = x => JSON.parse(JSON.stringify(x));
const row = (id, outcome = 'no_match') => ({supplierId: id, revision: 1, name: `Example ${id} Ltd`, fixtureOutcome: outcome});
const input = (...rows) => ({listId: 'test-list-v1', maxAttempts: 6, rows});

test('mixed run retains all nine rows, counts and screening evidence without decisions', () => {
  const result = runOffline(fixture);
  assert.equal(result.rowCount, 9);
  assert.equal(result.attempts, 4);
  assert.deepEqual(result.counts, {review: 1, no_match: 1, duplicate: 1, error: 4, unavailable: 2});
  assert.deepEqual(result.rows.map(r => r.rowNumber), [1,2,3,4,5,6,7,8,9]);
  assert.equal(result.rows[0].result.coverage[0].fresh, true);
  assert.equal(result.rows[0].result.matches.length, 1);
  assert.equal(result.rows[1].result.matches.length, 0);
  assert.equal(result.rows[8].attempted, false);
  assert.equal(result.rows[8].reason, 'run_stopped:coverage_unavailable');
  assert.ok(result.rows.every(r => r.businessDecision === 'not_decided'));
  assert.equal(result.evidenceBundleRetrieved, false);
  assert.equal(result.storage, 'n8n_execution_output_only');
});
test('identical duplicate skips a second request without pretending to have its own result', () => {
  const r = row('same'); const output = runOffline(input(r, copy(r)));
  assert.equal(output.attempts, 1);
  assert.equal(output.rows[1].rowStatus, 'duplicate');
  assert.equal(output.rows[1].duplicateOfRow, 1);
  assert.equal(output.rows[1].screeningId, null);
});
test('conflicting duplicate group is rejected before either member gets a request', () => {
  const r = row('same'); const output = runOffline(input(r, {...r, name: 'Changed Example Ltd'}));
  assert.equal(output.attempts, 0);
  assert.ok(output.rows.every(r => r.reason === 'duplicate_key_conflict'));
});
test('invalid row stays visible while later valid row can run', () => {
  const output = runOffline(input({...row('bad'), name: 'X'}, row('good')));
  assert.equal(output.rows[0].reason, 'invalid_supplier_row');
  assert.equal(output.rows[0].attempted, false);
  assert.equal(output.rows[1].rowStatus, 'no_match');
});
test('stable key and body are independent of order and workflow execution ID', () => {
  const a = row('a'), b = row('b');
  const first = prepare(input(a,b), 'sandbox_api');
  const second = prepare(input(b,a), 'sandbox_api');
  assert.deepEqual(first.queue[0].body, second.queue[1].body);
  assert.equal(first.queue[0].rowKey, second.queue[1].rowKey);
  assert.notEqual(requestFor('test-list-v1', {...a, revision: 2}).rowKey, first.queue[0].rowKey);
  assert.deepEqual(first.queue[0].body.subject.identifiers, []);
});
test('maxAttempts bounds requests and preserves the remaining rows', () => {
  const output = runOffline({...input(row('a'),row('b'),row('c')), maxAttempts: 1});
  assert.equal(output.attempts, 1);
  assert.equal(output.rows[1].reason, 'run_attempt_limit');
  assert.equal(output.rows[2].attempted, false);
});
for (const code of ['usage_cap_reached','rate_limited','coverage_unavailable','screening_policy_required','invalid_api_key']) {
  test(`${code} stops further attempts and is never a no-match`, () => {
    const output = runOffline(input(row('a',code),row('b')));
    assert.equal(output.attempts, 1);
    assert.equal(output.rows[0].rowStatus, 'unavailable');
    assert.equal(output.rows[1].reason, `run_stopped:${code}`);
  });
}
test('unknown network failure stops safely, keeps no raw message and never clears a row', () => {
  let state = next(prepare(input(row('a'),row('b')), 'sandbox_api'));
  state = record(state, {error: 'unexpected private subject or token must not survive'});
  const output = finish(next(state));
  assert.equal(output.rows[0].reason, 'request_failed');
  assert.equal(output.rows[0].rowStatus, 'error');
  assert.equal(output.rows[1].attempted, false);
  assert.ok(!JSON.stringify(output).includes('private subject'));
});
for (const [label, mutation] of [
  ['production environment', r => {r.environment = 'production';}],
  ['missing coverage', r => {r.coverage = [];}],
  ['stale coverage', r => {r.coverage[0].fresh = false;}],
  ['foreign coverage', r => {r.coverage[0].sourceId = 'other-source';}],
  ['inconsistent status', r => {r.status = 'potential_match';}],
  ['missing version', r => {delete r.versions.dataset;}],
]) {
  test(`${label} becomes an error and stops the run`, () => {
    const state = next(prepare(input(row('a'),row('b')), 'sandbox_api'));
    const response = fixtureResponse({...state.current, fixtureOutcome: 'no_match'});
    mutation(response);
    const output = finish(next(record(state, response)));
    assert.equal(output.rows[0].reason, 'invalid_or_unexpected_result');
    assert.equal(output.rows[0].screeningId, null);
    assert.equal(output.rows[1].attempted, false);
  });
}
test('empty list produces an honest zero-row output', () => {
  const output = runOffline(input());
  assert.equal(output.rowCount, 0); assert.equal(output.attempts, 0);
});
test('configuration and progress invariants reject malformed input and unrecorded attempts', () => {
  for (const bad of [{...input(),listId:'with:separator'}, {...input(),maxAttempts:21}, {...input(),rows:Array(101).fill(row('a'))}]) assert.throws(() => prepare(bad,'offline_fixture'));
  const state = next(prepare(input(row('a')), 'offline_fixture'));
  assert.throws(() => next(state), /previous_attempt/);
  assert.throws(() => finish(state), /unfinished/);
});
test('sandbox workflow has genuine node contract, fixed synthetic coverage and no embedded credentials', () => {
  const workflow = require('../supplier-review.sandbox.json');
  const screen = workflow.nodes.find(n => n.type === 'n8n-nodes-sanctionskit.sanctionsKit');
  assert.equal(screen.typeVersion, 1);
  assert.equal(screen.parameters.resource, 'screening');
  assert.equal(screen.parameters.operation, 'create');
  assert.equal(screen.parameters.coverage, 'sandbox');
  assert.equal(screen.parameters.simplify, false);
  assert.equal(screen.parameters.options.identifiers, '[]');
  assert.equal(screen.onError, 'continueRegularOutput');
  assert.equal(screen.retryOnFail, false);
  assert.equal(screen.credentials, undefined);
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  assert.ok(!workflow.nodes.find(n => n.name === 'Prepare supplier list').parameters.jsCode.includes('"fixtureOutcome"'));
});
test('both graphs have exactly one terminal register and a feedback edge through the recorder', () => {
  for (const filename of ['supplier-review.offline.json','supplier-review.sandbox.json']) {
    const workflow = JSON.parse(fs.readFileSync(path.join(__dirname,'..',filename)));
    assert.equal(workflow.connections['Record one row outcome'].main[0][0].node, 'Next supplier row');
    assert.equal(workflow.connections['Attempt or finish'].main[1][0].node, 'Supplier review register');
    assert.equal(workflow.connections['Supplier review register'], undefined);
    assert.ok(workflow.id);
  }
});

test('published node 0.1.0 executes workflow parameters against an intercepted helper', {skip: !process.env.SANCTIONSKIT_NODE_PACKAGE}, async () => {
  const vm = require('node:vm');
  const packageRoot = path.resolve(process.env.SANCTIONSKIT_NODE_PACKAGE);
  assert.equal(JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'))).version, '0.1.0');
  const {SanctionsKit} = require(path.join(packageRoot,'dist/nodes/SanctionsKit/SanctionsKit.node.js'));
  const screen = require('../supplier-review.sandbox.json').nodes.find(n => n.type === 'n8n-nodes-sanctionskit.sanctionsKit');
  let state = prepare(fixture, 'offline_fixture');
  let calls = 0;
  while (next(state).current) {
    const current = copy(state);
    const resolve = value => {
      if (typeof value === 'string' && value.startsWith('={{') && value.endsWith('}}')) return vm.runInNewContext(value.slice(3,-2), {$json: current});
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,resolve(v)]));
      return value;
    };
    const output = (await new SanctionsKit().execute.call({
      getInputData: () => [{json: current}], getNode: () => screen,
      getCredentials: async () => ({environment:'sandbox', apiKey:'sk_test_fixture_not_a_real_key'}),
      continueOnFail: () => true,
      getNodeParameter: (key, i, fallback) => screen.parameters[key] === undefined ? fallback : resolve(screen.parameters[key]),
      helpers: {httpRequestWithAuthentication: async (type, request) => {
        calls++;
        assert.equal(type,'sanctionsKitApi');
        assert.equal(request.url,'https://www.sanctionskit.com/api/v1/screenings');
        assert.equal(request.headers['Idempotency-Key'], current.current.rowKey);
        assert.deepEqual(request.body, current.current.body);
        assert.equal(request.disableFollowRedirect, true);
        const response = fixtureResponse(current.current);
        if (response.error) throw {statusCode: 400, response:{data:{error:{code: current.current.fixtureOutcome}}}};
        return {data: response};
      }},
    }))[0];
    assert.equal(output.length,1);
    assert.equal(output[0].pairedItem.item,0);
    state = record(state, output[0].json);
  }
  assert.equal(calls,4);
  assert.deepEqual(finish(state),runOffline(fixture));
});

test('non-string supplier and list IDs cannot be coerced into valid identity', () => {
  for (const id of [123,['supplier-a'],null,{}]) {
    const output = runOffline(input({...row('a'),supplierId:id}));
    assert.equal(output.attempts,0);
    assert.equal(output.rows[0].reason,'invalid_supplier_row');
  }
  for (const listId of [123,['list-a'],null,{}]) assert.throws(()=>prepare({...input(),listId},'offline_fixture'));
});
test('malformed candidates are errors rather than valid review results', () => {
  for (const match of [null,{}, {record:{},score:100,evidence:[],conflicts:[]}]) {
    const state = next(prepare(input(row('a')),'offline_fixture'));
    const response = fixtureResponse({...state.current,fixtureOutcome:'potential_match'});
    response.matches=[match];
    assert.equal(finish(next(record(state,response))).rows[0].reason,'invalid_or_unexpected_result');
  }
});
test('workflow timeout covers the supported maximum HTTP attempt budget with overhead', () => {
  const workflow=require('../supplier-review.sandbox.json');
  assert.ok(workflow.settings.executionTimeout > 20 * 30 + 60);
});

test('invalid payload sharing a valid row key blocks the entire ambiguous group', () => {
  const a=row('same');
  const result=runOffline(input(a,{...a,name:'X'}));
  assert.equal(result.attempts,0);
  assert.ok(result.rows.every(r=>r.reason==='duplicate_key_conflict'));
});
