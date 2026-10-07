const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const source = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\nmodule\.exports = [^\n]+;\s*$/, '\n');
const review = source('functions/review.cjs');
const fixtureFns = source('tests/fixtures/responses.cjs');
const base = require('./tests/fixtures/base-evidence.json');
const cases = require('./tests/fixtures/cases.json');
const event = { synthetic: true, eventId: 'onboarding:demo-person-001:v1', subject: { name: 'Alex Morgan', entityType: 'person', birthDate: '1984' } };
const codeNode = (name, position, jsCode) => ({ parameters: { mode: 'runOnceForAllItems', jsCode }, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, type: 'n8n-nodes-base.code', typeVersion: 2, position });
const noOp = (name, position) => ({ parameters: {}, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position });
const edge = name => ({ node: name, type: 'main', index: 0 });

function workflow(offline) {
  const nodes = [
    { parameters: {}, id: 'manual-trigger', name: 'Manual demonstration', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    codeNode('Synthetic onboarding events', [220, 200], 'return ' + JSON.stringify(offline ? cases.map(c => ({ ...event, eventId: 'onboarding:fixture:' + c.case + ':v1', fixtureCase: c.case })) : [event], null, 2) + '.map(json => ({json}));'),
    codeNode('Map onboarding event', [440, 200], review + '\nreturn $input.all().map((item, i) => ({ json: mapEvent(item.json), pairedItem: { item: i } }));'),
    offline
      ? codeNode('Screen synthetic subject', [660, 200], fixtureFns + '\nconst base = ' + JSON.stringify(base) + ';\nreturn $input.all().map((item, i) => ({ json: fixtureScreening(item.json, base), pairedItem: { item: i } }));')
      : { parameters: { resource: 'screening', operation: 'create', name: '={{ $json.request.subject.name }}', entityType: 'person', coverage: 'sandbox', idempotencyKey: '={{ $json.requestKey }}', options: { identifiers: '[]', birthDate: '={{ $json.request.subject.birthDate || "" }}', reference: '={{ $json.request.reference }}', retention: 'standard' }, simplify: false }, id: 'screen-synthetic-subject', name: 'Screen synthetic subject', type: 'n8n-nodes-sanctionskit.sanctionsKit', typeVersion: 1, position: [660, 200], onError: 'continueRegularOutput', notesInFlow: true, notes: 'Select your own sandbox credential. No credential is included. One attempt per item.' },
    codeNode('Classify screening response', [880, 200], review + '\nreturn $input.all().map((item, i) => ({ json: classifyScreening(item.json, $("Map onboarding event").itemMatching(i).json), pairedItem: { item: i } }));'),
    { parameters: { mode: 'expression', numberOutputs: 2, output: '={{ $json.route === "fetch_evidence" ? 0 : 1 }}' }, id: 'fetch-or-incomplete', name: 'Fetch evidence or incomplete', type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [1100, 200] },
    offline
      ? codeNode('Get same screening evidence', [1320, 100], fixtureFns + '\nconst base = ' + JSON.stringify(base) + ';\nreturn $input.all().map((item, i) => ({ json: fixtureEvidence(item.json, base), pairedItem: { item: i } }));')
      : { parameters: { resource: 'screening', operation: 'getEvidence', screeningId: '={{ $json.screeningId }}' }, id: 'get-same-screening-evidence', name: 'Get same screening evidence', type: 'n8n-nodes-sanctionskit.sanctionsKit', typeVersion: 1, position: [1320, 100], onError: 'continueRegularOutput', notesInFlow: true, notes: 'Use the same sandbox credential. Evidence errors remain incomplete.' },
    codeNode('Build review record', [1540, 100], review + '\nreturn $input.all().map((item, i) => ({ json: finishEvidence(item.json, $("Classify screening response").itemMatching(i).json), pairedItem: { item: i } }));'),
    { parameters: { mode: 'expression', numberOutputs: 4, output: '={{ ({review_required: 0, no_match_policy_review: 1, request_error: 2, coverage_unavailable: 3})[$json.route] ?? 2 }}' }, id: 'route-review-record', name: 'Route review record', type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [1770, 250] },
    noOp('Potential match - human review', [2030, 0]),
    noOp('No match - apply organization policy', [2030, 170]),
    noOp('Request or evidence error - incomplete', [2030, 340]),
    noOp('Coverage unavailable - incomplete', [2030, 510]),
    { parameters: { content: offline
      ? '## OFFLINE synthetic onboarding review\nTen invented fixture cases exercise all four routes. No API call, credentials, or real subjects. This is a local demonstration, not live screening. Open the four final nodes to inspect the records. All decisions remain **not_made**.\n\nThe separate sandbox workflow uses n8n-nodes-sanctionskit@0.1.0 and requires your own sandbox credential. Sandbox is free and synthetic; production screening is paid.'
      : '## Sandbox onboarding review\nUse n8n-nodes-sanctionskit@0.1.0 and select your own **sandbox** credential on both SanctionsKit nodes. Alex Morgan is invented. Coverage is fixed to sandbox@1. This template makes API requests only when you run it.\n\nPotential matches require human review. No match is limited to selected coverage and never approves onboarding. No durable queue, webhook, retry, or customer update is configured. Production requires deliberate adaptation; see README.', height: 300, width: 1040 }, id: 'read-first', name: 'Read first', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -170] },
  ];
  const names = ['Manual demonstration', 'Synthetic onboarding events', 'Map onboarding event', 'Screen synthetic subject', 'Classify screening response', 'Fetch evidence or incomplete'];
  const connections = {};
  for (let i = 0; i < names.length - 1; i++) connections[names[i]] = { main: [[edge(names[i + 1])]] };
  connections['Fetch evidence or incomplete'] = { main: [[edge('Get same screening evidence')], [edge('Route review record')]] };
  connections['Get same screening evidence'] = { main: [[edge('Build review record')]] };
  connections['Build review record'] = { main: [[edge('Route review record')]] };
  connections['Route review record'] = { main: ['Potential match - human review', 'No match - apply organization policy', 'Request or evidence error - incomplete', 'Coverage unavailable - incomplete'].map(n => [edge(n)]) };
  return { id: offline ? 'SanctionsKitOfflineReview' : 'SanctionsKitSandboxReview', name: 'SanctionsKit onboarding review - ' + (offline ? 'OFFLINE fixtures' : 'synthetic sandbox'), nodes, pinData: {}, connections, active: false, settings: { executionOrder: 'v1' }, tags: [] };
}

for (const offline of [true, false]) fs.writeFileSync(path.join(root, 'onboarding-review.' + (offline ? 'offline' : 'sandbox') + '.json'), JSON.stringify(workflow(offline), null, 2) + '\n');
