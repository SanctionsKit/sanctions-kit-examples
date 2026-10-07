'use strict';
const fs = require('node:fs');
const path = require('node:path');
const input = require('./fixtures/suppliers.json');
const core = fs.readFileSync(path.join(__dirname, 'functions/register.cjs'), 'utf8').replace(/^module\.exports =.*;\s*$/m, '');
const code = (name, id, body, position) => ({parameters: {mode: 'runOnceForAllItems', jsCode: core + '\n' + body}, id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position});
function workflow(mode) {
  const offline = mode === 'offline_fixture';
  const rows = offline ? input : {...input, rows: input.rows.map(({fixtureOutcome, ...row}) => row)};
  const nodes = [
    {parameters: {}, id: 'supplier-manual', name: 'Run manually', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 100]},
    code('Prepare supplier list', 'supplier-prepare', `const input = ${JSON.stringify(rows, null, 2)};\nreturn [{json: prepare(input, '${mode}')}];`, [240, 100]),
    code('Next supplier row', 'supplier-next', 'return [{json: next($input.first().json), pairedItem: {item: 0}}];', [500, 100]),
    {parameters: {mode: 'expression', numberOutputs: 2, output: '={{ $json.current ? 0 : 1 }}'}, id: 'supplier-route', name: 'Attempt or finish', type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [740, 100]},
    offline ? code('Synthetic response only', 'supplier-response', 'return [{json: fixtureResponse($input.first().json.current), pairedItem: {item: 0}}];', [990, 0]) : {
      parameters: {resource: 'screening', operation: 'create', name: '={{ $json.current.body.subject.name }}', entityType: 'organization', coverage: 'sandbox', idempotencyKey: '={{ $json.current.rowKey }}', options: {country: '={{ $json.current.body.subject.country || "" }}', identifiers: '[]', reference: '={{ $json.current.body.reference }}', retention: 'standard'}, simplify: false},
      id: 'supplier-response', name: 'Screen one supplier in sandbox', type: 'n8n-nodes-sanctionskit.sanctionsKit', typeVersion: 1, position: [990, 0], onError: 'continueRegularOutput', retryOnFail: false,
    },
    code('Record one row outcome', 'supplier-record', "const state = clone($('Next supplier row').item.json);\nreturn [{json: record(state, $input.first().json), pairedItem: {item: 0}}];", [1240, 0]),
    code('Supplier review register', 'supplier-finish', 'return [{json: finish($input.first().json), pairedItem: {item: 0}}];', [990, 270]),
    {parameters: {content: offline ? '## Offline supplier-row review demo\nAll suppliers and responses are invented. No credentials, community node or network request. Inspect Supplier review register after execution. This output is not a saved spreadsheet or external register.\n\nStable list/supplier/revision keys; identical duplicates skip; conflicting duplicates fail; shared faults stop further attempts. No supplier is automatically approved.' : '## Synthetic sandbox adaptation\nInstall n8n-nodes-sanctionskit 0.1.0 and select a sandbox credential on Screen one supplier in sandbox. No credentials are embedded. This version calls the hosted API when executed; only invented supplier rows are provided. Actual outcomes may differ from offline fixtures.\n\nOne attempt at a time; no automatic retry. Shared/unknown failures stop remaining requests. Review the README before adapting. Production screening is paid and is not configured here.', height: 300, width: 800}, id: 'supplier-notes', name: 'Read first', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [200, -360]},
  ];
  const requestName = offline ? 'Synthetic response only' : 'Screen one supplier in sandbox';
  const connect = name => [{node: name, type: 'main', index: 0}];
  return {
    id: offline ? 'skSupplierReviewOfflineV1' : 'skSupplierReviewSandboxV1',
    name: offline ? 'SanctionsKit supplier row register - offline fixtures' : 'SanctionsKit supplier row register - synthetic sandbox',
    nodes,
    connections: {
      'Run manually': {main: [connect('Prepare supplier list')]},
      'Prepare supplier list': {main: [connect('Next supplier row')]},
      'Next supplier row': {main: [connect('Attempt or finish')]},
      'Attempt or finish': {main: [connect(requestName), connect('Supplier review register')]},
      [requestName]: {main: [connect('Record one row outcome')]},
      'Record one row outcome': {main: [connect('Next supplier row')]},
    },
    active: false, settings: {executionOrder: 'v1', executionTimeout: 900}, pinData: {}, tags: [],
  };
}
for (const [name, mode] of [['supplier-review.offline.json', 'offline_fixture'], ['supplier-review.sandbox.json', 'sandbox_api']]) {
  const output = JSON.stringify(workflow(mode), null, 2) + '\n';
  const file = path.join(__dirname, name);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== output) throw new Error(`${name} is stale; run npm run build`);
  } else fs.writeFileSync(file, output);
}
const example = JSON.stringify(require('./functions/register.cjs').runOffline(input), null, 2) + '\n';
const exampleFile = path.join(__dirname, 'fixtures/example-register.json');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(exampleFile, 'utf8') !== example) throw new Error('example-register.json is stale');
} else fs.writeFileSync(exampleFile, example);
