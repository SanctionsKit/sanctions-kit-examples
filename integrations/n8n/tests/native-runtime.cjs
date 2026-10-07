// Optional native n8n check. Only the credential-free OFFLINE workflow is executed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const bin = process.env.N8N_BIN;
if (!bin || !path.isAbsolute(bin) || !fs.existsSync(bin)) throw new Error('Set N8N_BIN to the absolute path of an installed n8n/bin/n8n');
const n8nPackage = JSON.parse(fs.readFileSync(path.join(path.dirname(bin), '..', 'package.json')));
if (n8nPackage.version !== '2.41.4') throw new Error('This native check is qualified for n8n 2.41.4; review before using another runtime');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctionskit-n8n-onboarding-'));
const root = path.resolve(__dirname, '..');
const commands = [];
const env = {
  ...process.env,
  N8N_DIAGNOSTICS_ENABLED: 'false',
  N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
  N8N_TEMPLATES_ENABLED: 'false',
  N8N_LICENSE_AUTO_RENEW_ENABLED: 'false',
  N8N_COMMUNITY_PACKAGES_ENABLED: 'false',
  N8N_RUNNERS_MODE: 'internal',
  N8N_RUNNERS_BROKER_LISTEN_ADDRESS: '127.0.0.1',
  N8N_RUNNERS_BROKER_PORT: process.env.N8N_TEST_RUNNER_PORT || '16897',
  // n8n's CLI also uses info-level logging for the --rawOutput JSON document.
  N8N_LOG_LEVEL: 'info',
};

function run(state, label, args) {
  const userFolder = path.join(directory, state);
  fs.mkdirSync(userFolder, { recursive: true });
  const result = spawnSync(process.execPath, [bin, ...args], { env: { ...env, N8N_USER_FOLDER: userFolder }, encoding: 'utf8', timeout: 240000, maxBuffer: 30 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(directory, label + '.log'), output);
  commands.push({ label, args, status: result.status, signal: result.signal });
  if (result.error || result.status !== 0) throw new Error(`${label} failed; inspect ${directory}/${label}.log: ${result.error?.message || result.status}`);
  return output;
}

function onlyWorkflow(file) {
  const value = JSON.parse(fs.readFileSync(file));
  assert.ok(Array.isArray(value) && value.length === 1, 'Expected one exported workflow');
  return value[0];
}

for (const mode of ['offline', 'sandbox']) {
  const source = path.join(root, `onboarding-review.${mode}.json`);
  const workflow = JSON.parse(fs.readFileSync(source));
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.every(n => !n.credentials));
  const exported = path.join(directory, mode + '-export.json');
  const roundtrip = path.join(directory, mode + '-roundtrip.json');
  run('first-state', mode + '-import', ['import:workflow', '--input=' + source]);
  run('first-state', mode + '-export', ['export:workflow', '--id=' + workflow.id, '--output=' + exported]);
  run('second-state', mode + '-roundtrip-import', ['import:workflow', '--input=' + exported]);
  run('second-state', mode + '-roundtrip-export', ['export:workflow', '--id=' + workflow.id, '--output=' + roundtrip]);
  for (const file of [exported, roundtrip]) {
    const value = onlyWorkflow(file);
    assert.deepEqual(value.nodes, workflow.nodes);
    assert.deepEqual(value.connections, workflow.connections);
    assert.deepEqual(value.pinData, {});
    assert.equal(value.active, false);
  }
}

const offline = require('../onboarding-review.offline.json');
assert.ok(offline.nodes.every(n => ['manualTrigger', 'code', 'switch', 'noOp', 'stickyNote'].some(type => n.type === 'n8n-nodes-base.' + type)));
const raw = run('second-state', 'offline-execute', ['execute', '--id=' + offline.id, '--rawOutput']);
// CLI startup notices may precede the one JSON execution document.
const start = raw.indexOf('{\n  "');
assert.ok(start >= 0, 'Missing native execution JSON');
let end = start, depth = 0, quoted = false, escaped = false;
for (; end < raw.length; end++) {
  const char = raw[end];
  if (quoted) {
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') quoted = false;
  } else if (char === '"') quoted = true;
  else if (char === '{') depth++;
  else if (char === '}' && --depth === 0) { end++; break; }
}
const execution = JSON.parse(raw.slice(start, end));
assert.equal(execution.status, 'success');
assert.equal(execution.data.resultData.error, undefined);
const runData = execution.data.resultData.runData;
const ends = ['Potential match - human review', 'No match - apply organization policy', 'Request or evidence error - incomplete', 'Coverage unavailable - incomplete'];
const records = ends.flatMap(name => (runData[name] || []).flatMap(run => run.data.main.flat().map(item => ({ ...item.json, actualEndpoint: name }))));
const expectedEndpoint = { review_required: ends[0], no_match_policy_review: ends[1], request_error: ends[2], coverage_unavailable: ends[3] };
const cases = require('./fixtures/cases.json');
assert.equal(records.length, cases.length);
assert.equal(new Set(records.map(record => record.eventId)).size, cases.length);
for (const record of records) {
  assert.equal(record.route, cases.find(c => c.case === record.fixtureCase).route);
  assert.equal(record.actualEndpoint, expectedEndpoint[record.route], 'Record reached the wrong native output node');
  assert.equal(record.onboardingDecision, 'not_made');
  assert.equal(record.requestKey, 'n8n:' + record.eventId);
  if (record.evidence) assert.equal(record.evidence.reference, record.eventId);
}
const report = {
  checkedAt: new Date().toISOString(),
  nodeVersion: process.version,
  n8nVersion: n8nPackage.version,
  directory,
  importsAndExports: 'both workflows imported/exported and re-imported/exported in separate fresh n8n state; node graph unchanged',
  nativeExecuted: 'offline only',
  sandboxExecuted: false,
  hostedApiCalls: 0,
  routes: Object.fromEntries(ends.map(name => [name, records.filter(record => record.actualEndpoint === name).length])),
  cases: records.map(({ eventId, fixtureCase, route, actualEndpoint, onboardingDecision }) => ({ eventId, fixtureCase, route, actualEndpoint, onboardingDecision })),
  sourceSha256: Object.fromEntries(['offline', 'sandbox'].map(mode => [mode, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, `onboarding-review.${mode}.json`))).digest('hex')])),
  commands,
};
fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
