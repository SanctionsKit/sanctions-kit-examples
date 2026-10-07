const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mapEvent, classifyScreening, finishEvidence, outputIndex } = require('../functions/review.cjs');
const { fixtureScreening, fixtureEvidence } = require('./fixtures/responses.cjs');
const base = require('./fixtures/base-evidence.json');
const cases = require('./fixtures/cases.json');
const event = { synthetic: true, eventId: 'onboarding:fixture:v1', subject: { name: 'Alex Morgan', entityType: 'person', birthDate: '1984' } };
const clone = value => JSON.parse(JSON.stringify(value));

for (const scenario of cases) test('routes fixture: ' + scenario.case, () => {
  const context = mapEvent({ ...event, fixtureCase: scenario.case });
  let output = classifyScreening(fixtureScreening(context, base), context);
  if (output.route === 'fetch_evidence') output = finishEvidence(fixtureEvidence(output, base), output);
  assert.equal(output.route, scenario.route);
  assert.equal(output.eventId, event.eventId);
  assert.equal(output.requestKey, 'n8n:' + event.eventId);
  assert.equal(output.onboardingDecision, 'not_made');
  if (['review_required', 'no_match_policy_review'].includes(output.route)) {
    assert.deepEqual(output.evidence.result, output.result);
    assert.equal(output.evidence.reference, event.eventId);
    assert.deepEqual(output.evidence.request, output.request);
  } else assert.equal(output.evidence, undefined);
});

test('stable identity and unchanged request survive retries', () => {
  assert.deepEqual(mapEvent(event), mapEvent(clone(event)));
  assert.notEqual(mapEvent({ ...event, eventId: event.eventId + ':new' }).requestKey, mapEvent(event).requestKey);
  assert.equal(mapEvent({ ...event, subject: { name: 'Alex Morgan', entityType: 'person' } }).request.subject.birthDate, undefined);
});

test('invalid or unmarked input stops before screening', () => {
  for (const bad of [{ ...event, synthetic: false }, { ...event, eventId: 'has spaces' }, { ...event, eventId: 12345678 }, { ...event, eventId: 'x'.repeat(125) }, { ...event, subject: { ...event.subject, birthDate: '0000' } }, { ...event, subject: { ...event.subject, birthDate: 1984 } }]) assert.throws(() => mapEvent(bad));
});

test('malformed results, wrong environment, and ambiguous errors stay incomplete', () => {
  const context = mapEvent(event);
  for (const bad of [null, {}, { ...base.result, environment: 'production' }, { ...base.result, status: 'cleared' }, { ...base.result, status: 'no_match' }, { ...base.result, matches: [] }, { ...base.result, versions: {} }, { ...base.result, disclaimer: '' }, { error: '' }, { error: 'prefix SanctionsKit request failed (coverage_unavailable)' }]) assert.equal(classifyScreening(bad, context).route, 'request_error');
  assert.equal(classifyScreening({ ...base.result, coverage: [{ ...base.result.coverage[0], fresh: false }] }, context).route, 'coverage_unavailable');
  assert.equal(outputIndex('unrecognized'), 2);
});

test('evidence must belong to the same result and input, with retained standard inputs', () => {
  const context = classifyScreening(clone(base.result), mapEvent(event));
  const valid = fixtureEvidence(context, base);
  const variants = [
    { ...valid, format: 'unknown' }, { ...valid, retention: 'minimal' }, { ...valid, retainedInputs: false },
    { ...valid, reference: 'other-event' }, { ...valid, subject: { name: 'Other synthetic subject' } },
    { ...valid, request: { ...valid.request, reference: 'other-event' } },
    { ...valid, request: { ...valid.request, policy: { id: '00000000-0000-4000-8000-000000000002', version: 1 } } },
    { ...valid, result: { ...valid.result, disclaimer: 'changed' } },
    { ...valid, result: { ...valid.result, versions: { ...valid.result.versions, dataset: 'other' } } },
  ];
  for (const bad of variants) {
    const output = finishEvidence(bad, context);
    assert.equal(output.route, 'request_error');
    assert.deepEqual(output.result, context.result);
    assert.equal(output.onboardingDecision, 'not_made');
  }
  const reordered = clone(valid);
  reordered.result = Object.fromEntries(Object.entries(reordered.result).reverse());
  assert.equal(finishEvidence(reordered, context).route, 'review_required');
});

test('malformed candidates and an unexpected package remain incomplete', () => {
  const context = mapEvent(event);
  for (const bad of [null, {}, { ...base.result.matches[0], evidence: [null] }, { ...base.result.matches[0], record: {} }, { ...base.result.matches[0], score: 101 }]) {
    assert.equal(classifyScreening({ ...base.result, matches: [bad] }, context).route, 'request_error');
  }
  assert.equal(classifyScreening({ ...base.result, versions: { ...base.result.versions, package: 'other@1' } }, context).route, 'request_error');
});

test('exports contain no credentials or pin data and sandbox cannot silently use production', () => {
  for (const mode of ['offline', 'sandbox']) {
    const flow = require('../onboarding-review.' + mode + '.json');
    assert.equal(flow.active, false);
    assert.deepEqual(flow.pinData, {});
    for (const node of flow.nodes) assert.equal(node.credentials, undefined);
    const api = flow.nodes.filter(n => n.type === 'n8n-nodes-sanctionskit.sanctionsKit');
    assert.equal(api.length, mode === 'offline' ? 0 : 2);
    for (const node of api) assert.equal(node.onError, 'continueRegularOutput');
    if (mode === 'sandbox') {
      assert.equal(api[0].parameters.coverage, 'sandbox');
      assert.equal(api[0].parameters.simplify, false);
      assert.equal(api[1].parameters.screeningId, '={{ $json.screeningId }}');
    }
  }
});

test('exported Code nodes preserve item links when evidence inputs are filtered', () => {
  const flow = require('../onboarding-review.offline.json');
  const run = (name, items, upstream = {}) => {
    const node = flow.nodes.find(n => n.name === name);
    return vm.runInNewContext('(function(){' + node.parameters.jsCode + '\n})()', {
      $input: { all: () => items },
      $: source => ({ itemMatching: i => upstream[source][i] }),
    });
  };
  const events = run('Synthetic onboarding events', []);
  const mapped = run('Map onboarding event', events);
  const screened = run('Screen synthetic subject', mapped);
  const classified = run('Classify screening response', screened, { 'Map onboarding event': mapped });
  const fetchedInputs = classified.filter(item => item.json.route === 'fetch_evidence');
  const evidence = run('Get same screening evidence', fetchedInputs);
  const finished = run('Build review record', evidence, { 'Classify screening response': fetchedInputs });
  const all = [...finished, ...classified.filter(item => item.json.route !== 'fetch_evidence')];
  assert.equal(all.length, cases.length);
  assert.equal(new Set(all.map(item => item.json.eventId)).size, cases.length);
  for (const item of all) assert.equal(item.json.route, cases.find(c => c.case === item.json.fixtureCase).route);
  finished.forEach((item, i) => assert.equal(item.pairedItem.item, i));
});

test('published node v0.1.0 contract using intercepted helper only', { skip: !process.env.SANCTIONSKIT_NODE_PACKAGE }, async () => {
  const packageRoot = path.resolve(process.env.SANCTIONSKIT_NODE_PACKAGE);
  assert.equal(JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'))).version, '0.1.0');
  const { SanctionsKit } = require(path.join(packageRoot, 'dist/nodes/SanctionsKit/SanctionsKit.node.js'));
  const workflow = require('../onboarding-review.sandbox.json');
  const contexts = cases.map(c => mapEvent({ ...event, eventId: 'onboarding:fixture:' + c.case + ':v1', fixtureCase: c.case }));
  const calls = [];
  async function execute(operation, inputs) {
    let current;
    const node = workflow.nodes.find(n => n.type === 'n8n-nodes-sanctionskit.sanctionsKit' && n.parameters.operation === operation);
    const resolve = value => {
      if (typeof value === 'string' && value.startsWith('={{') && value.endsWith('}}')) return vm.runInNewContext(value.slice(3, -2), { $json: current });
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
      return value;
    };
    return (await new SanctionsKit().execute.call({
      getInputData: () => inputs.map(json => ({ json })),
      getNode: () => node,
      getCredentials: async () => ({ apiKey: 'sk_test_fixture_not_a_real_key', environment: 'sandbox' }),
      continueOnFail: () => true,
      getNodeParameter: (name, i, fallback) => {
        current = inputs[i];
        return node.parameters[name] === undefined ? fallback : resolve(node.parameters[name]);
      },
      helpers: { httpRequestWithAuthentication: async (credentialType, request) => {
        calls.push({ context: current, operation, credentialType, request: clone(request) });
        const response = operation === 'create' ? fixtureScreening(current, base) : fixtureEvidence(current, base);
        if (typeof response.error === 'string') {
          const code = /\(([a-z_]+)\)/.exec(response.error)[1];
          throw { statusCode: ['coverage_unavailable', 'stale_coverage'].includes(code) ? 503 : 400, response: { data: { error: { code } } } };
        }
        return operation === 'create' ? { data: response } : response;
      } },
    }))[0];
  }
  const screened = await execute('create', contexts);
  assert.equal(screened.length, contexts.length);
  const classified = screened.map((item, i) => {
    assert.equal(item.pairedItem.item, i);
    return classifyScreening(item.json, contexts[i]);
  });
  const retained = classified.filter(c => c.route === 'fetch_evidence');
  const evidence = await execute('getEvidence', retained);
  const finished = evidence.map((item, i) => {
    assert.equal(item.pairedItem.item, i);
    return finishEvidence(item.json, retained[i]);
  });
  const all = [...finished, ...classified.filter(c => c.route !== 'fetch_evidence')];
  assert.equal(all.length, cases.length);
  for (const item of all) assert.equal(item.route, cases.find(c => c.case === item.fixtureCase).route);
  for (const call of calls) {
    assert.equal(call.credentialType, 'sanctionsKitApi');
    if (call.operation === 'create') {
      assert.equal(call.request.headers['Idempotency-Key'], call.context.requestKey);
      assert.deepEqual(call.request.body, call.context.request);
      assert.equal(call.request.url, 'https://www.sanctionskit.com/api/v1/screenings');
    } else assert.equal(call.request.url, 'https://www.sanctionskit.com/api/v1/results/' + call.context.screeningId + '/evidence');
  }
});
