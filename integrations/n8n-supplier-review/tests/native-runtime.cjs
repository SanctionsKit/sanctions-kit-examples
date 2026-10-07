'use strict';
// Both variants are imported/exported; ONLY core-node offline fixtures are executed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'..');
const bin = process.env.N8N_BIN;
if (!bin || !path.isAbsolute(bin) || !fs.existsSync(bin)) throw new Error('Set N8N_BIN to an installed absolute n8n/bin/n8n path');
const runtimeVersion = JSON.parse(fs.readFileSync(path.join(path.dirname(bin),'../package.json'))).version;
assert.equal(runtimeVersion,'2.41.4','Review this check before using another n8n version');
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'sanctionskit-n8n-supplier-'));
const commands = [];
const env = {...process.env,
  N8N_DIAGNOSTICS_ENABLED:'false', N8N_VERSION_NOTIFICATIONS_ENABLED:'false',
  N8N_TEMPLATES_ENABLED:'false', N8N_LICENSE_AUTO_RENEW_ENABLED:'false',
  N8N_COMMUNITY_PACKAGES_ENABLED:'false', N8N_RUNNERS_MODE:'internal',
  N8N_RUNNERS_BROKER_LISTEN_ADDRESS:'127.0.0.1',
  N8N_RUNNERS_BROKER_PORT: process.env.N8N_TEST_RUNNER_PORT || '16898',
  N8N_LOG_LEVEL:'info',
};
function run(state,label,args) {
  const userFolder = path.join(directory,state);
  fs.mkdirSync(userFolder,{recursive:true});
  const r = spawnSync(process.execPath,[bin,...args], {env:{...env,N8N_USER_FOLDER:userFolder},encoding:'utf8',timeout:240000,killSignal:'SIGKILL',maxBuffer:30*1024*1024});
  const output = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(directory,label+'.log'),output);
  commands.push({label,args,status:r.status,signal:r.signal});
  if (r.error || r.status !== 0) throw new Error(`${label} failed: ${directory}/${label}.log (${r.error?.message || r.status})`);
  return output;
}
for (const mode of ['offline','sandbox']) {
  const source = path.join(root,`supplier-review.${mode}.json`);
  const workflow = JSON.parse(fs.readFileSync(source));
  assert.equal(workflow.active,false);
  assert.ok(workflow.nodes.every(n => !n.credentials));
  const exported = path.join(directory,mode+'-export.json'), roundtrip = path.join(directory,mode+'-roundtrip.json');
  run('first',mode+'-import',['import:workflow','--input='+source]);
  run('first',mode+'-export',['export:workflow','--id='+workflow.id,'--output='+exported]);
  run('second',mode+'-roundtrip-import',['import:workflow','--input='+exported]);
  run('second',mode+'-roundtrip-export',['export:workflow','--id='+workflow.id,'--output='+roundtrip]);
  for (const file of [exported,roundtrip]) {
    const result = JSON.parse(fs.readFileSync(file));
    assert.equal(result.length,1);
    assert.deepEqual(result[0].nodes,workflow.nodes);
    assert.deepEqual(result[0].connections,workflow.connections);
    assert.equal(result[0].active,false);
    assert.deepEqual(result[0].pinData,{});
  }
}
function parseExecution(raw) {
  const start = raw.indexOf('{\n  "');
  assert.ok(start >= 0,'Missing execution JSON');
  let end = start, depth = 0, quoted = false, escaped = false;
  for (; end < raw.length; end++) {
    const char = raw[end];
    if (quoted) {if (escaped) escaped=false; else if (char==='\\') escaped=true; else if(char==='"') quoted=false;}
    else if(char==='"') quoted=true;
    else if(char==='{') depth++;
    else if(char==='}' && --depth===0) {end++;break;}
  }
  return JSON.parse(raw.slice(start,end));
}
const workflow = require('../supplier-review.offline.json');
assert.ok(workflow.nodes.every(n => ['manualTrigger','code','switch','stickyNote'].some(type=>n.type==='n8n-nodes-base.'+type)));
const raw = run('second','offline-execute',['execute','--id='+workflow.id,'--rawOutput']);
const execution = parseExecution(raw);
assert.equal(execution.status,'success');
assert.equal(execution.data.resultData.error,undefined);
const runs = execution.data.resultData.runData;
assert.equal(runs['Supplier review register'].length,1);
const actual = runs['Supplier review register'][0].data.main[0];
assert.equal(actual.length,1);
const expected = require('../fixtures/example-register.json');
assert.deepEqual(actual[0].json,expected);
assert.equal(runs['Synthetic response only'].length,expected.attempts);
assert.equal(runs['Record one row outcome'].length,expected.attempts);
assert.equal(runs['Next supplier row'].length,expected.attempts+1);
assert.ok(!runs['Screen one supplier in sandbox']);
const report = {
  checkedAt:new Date().toISOString(),nodeVersion:process.version,n8nVersion:runtimeVersion,directory,
  nativeExecuted:'offline fixture only',sandboxExecuted:false,hostedApiCalls:0,
  importsAndExports:'both variants round-tripped through two fresh local n8n states with graph preserved',
  actualFinalNode:'Supplier review register',rowCount:expected.rowCount,attempts:expected.attempts,counts:expected.counts,
  sourceSha256:Object.fromEntries(['offline','sandbox'].map(mode=>[mode,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,`supplier-review.${mode}.json`))).digest('hex')])),
  commands,
};
fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
