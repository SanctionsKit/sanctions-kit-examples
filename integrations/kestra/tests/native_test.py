"""Execute the actual flow in a loopback-only Kestra 2.0.4 instance.

Only fictional fixtures are sent to an in-process local HTTP server. This file
never contacts the hosted SanctionsKit API and never needs a real API key.
"""
import base64
import copy
import csv
import io
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
KESTRA = os.getenv('KESTRA_TEST_URL', 'http://127.0.0.1:28101')
assert urllib.parse.urlsplit(KESTRA).hostname in ('127.0.0.1', 'localhost')
AUTH = 'Basic ' + base64.b64encode(b'local@sanctionskit.invalid:LocalMockOnly123!').decode()
MOCK_KEY = 'local-mock-only'
BATCH = '11111111-1111-4111-8111-111111111111'
IDS = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
SUBJECTS = [
    {'subject': {'name': 'Alex Morgan', 'entityType': 'person', 'birthDate': '1984'}, 'package': 'sandbox@1', 'retention': 'standard', 'reference': 'example-customer-001'},
    {'subject': {'name': 'Taylor Jordan', 'entityType': 'person', 'birthDate': '1979'}, 'package': 'sandbox@1', 'retention': 'standard', 'reference': 'example-customer-002'},
]
TEMPLATE = json.loads((ROOT / 'tests/fixtures/synthetic-evidence.json').read_text())

class State:
    mode = 'success'
    calls = []
    polls = 0

class Mock(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, code, body):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def request_record(self):
        assert self.headers.get('Authorization') == 'Bearer ' + MOCK_KEY
        State.calls.append({'method': self.command, 'path': self.path})

    def do_POST(self):
        self.request_record()
        assert self.path == '/api/v1/batches'
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert body == {'name': 'Kestra fictional onboarding example', 'subjects': SUBJECTS}
        assert self.headers['Idempotency-Key'] == 'native-test-' + State.mode
        State.calls[-1]['idempotency_key'] = self.headers['Idempotency-Key']
        State.calls[-1]['body'] = body
        if State.mode == 'rate_limited_once' and len(State.calls) == 1:
            self.respond(429, {'error': {'code': 'synthetic_retry', 'message': 'Try once more'}})
            return
        if State.mode in ('unauthorized', 'rate_limited', 'server_error', 'conflict'):
            self.respond({'unauthorized': 401, 'rate_limited': 429, 'server_error': 503, 'conflict': 409}[State.mode], {'error': {'code': 'synthetic_test_error', 'message': 'Fictional test response'}})
            return
        if State.mode == 'redirect':
            self.send_response(302)
            self.send_header('Location', 'http://127.0.0.1:28102/do-not-follow')
            self.end_headers()
            return
        self.respond(202, {'data': {'id': '../not-an-id' if State.mode == 'bad_batch_id' else BATCH, 'status': 'pending', 'total': 2}})

    def do_GET(self):
        self.request_record()
        if self.path.startswith('/api/v1/batches/'):
            assert self.path == f'/api/v1/batches/{BATCH}?limit=100&offset=0'
            State.polls += 1
            status = 'processing' if State.polls == 1 or State.mode == 'timeout' else 'completed'
            rows = [{'row_number': i + 1, 'status': 'pending' if status == 'processing' else 'completed', 'screening_id': None if status == 'processing' else IDS[i], 'error': None} for i in range(2)]
            if status == 'completed' and State.mode in ('mixed', 'all_failed', 'cancelled'):
                indexes = [1] if State.mode == 'mixed' else [0, 1]
                for i in indexes:
                    rows[i].update(status='cancelled' if State.mode == 'cancelled' else 'failed', screening_id=None, error={'code': 'synthetic_row_error', 'message': 'Fictional row outcome'})
                if State.mode == 'cancelled': status = 'cancelled'
                if State.mode == 'all_failed': status = 'failed'
            if status == 'completed' and State.mode == 'unfinished':
                rows[1].update(status='pending', screening_id=None)
            if status == 'completed' and State.mode == 'bad_uuid': rows[0]['screening_id'] = '../not-an-id'
            if status == 'completed' and State.mode == 'row_order': rows.reverse()
            self.respond(200, {'data': {'id': IDS[0] if State.mode == 'wrong_batch' else BATCH, 'name': 'Kestra fictional onboarding example', 'environment': 'production' if State.mode == 'wrong_environment' else 'sandbox', 'status': status, 'total': 2, 'completed': sum(r['status'] == 'completed' for r in rows) + (1 if State.mode == 'counter_mismatch' else 0), 'failed': sum(r['status'] == 'failed' for r in rows), 'created_at': '2026-01-01T00:00:00Z', 'cancelled_at': '2026-01-01T00:01:00Z' if State.mode == 'cancelled' else None, 'rows': rows, 'nextOffset': 2 if State.mode == 'extra_page' else None}})
            return
        m = re.fullmatch('/api/v1/results/([a-f0-9-]+)/evidence', self.path)
        assert m and m[1] in IDS
        i = IDS.index(m[1])
        evidence = copy.deepcopy(TEMPLATE)
        evidence['result']['id'] = IDS[i]
        evidence['subject'] = SUBJECTS[i]['subject']
        evidence['reference'] = SUBJECTS[i]['reference']
        evidence['request'] = SUBJECTS[i]
        if i == 1:
            evidence['result'].update(status='no_match', matches=[])
        if State.mode == 'wrong_evidence': evidence['result']['id'] = BATCH
        if State.mode == 'wrong_package': evidence['result']['versions']['package'] = 'wrong@1'
        if State.mode == 'wrong_match_count': evidence['result']['matches'] = []
        if State.mode == 'wrong_contact': evidence['subject'] = {**evidence['subject'], 'birthDate': '1984-01-01'}
        self.respond(200, evidence)


def api(path, data=None, content_type=None, method=None, timeout=15):
    headers = {'Authorization': AUTH}
    if content_type: headers['Content-Type'] = content_type
    req = urllib.request.Request(KESTRA + '/api/v1/main' + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            return json.loads(payload) if 'json' in r.headers.get('Content-Type', '') else payload
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Local Kestra HTTP {e.code}: {e.read().decode()[:2000]}') from None


def capture_failure(execution):
    """Save bounded local task diagnostics without replacing the test failure."""
    def fetch(path):
        try:
            return api(path, timeout=3)
        except Exception as error:
            return {'diagnostic_error_type': type(error).__name__}

    family = [execution]
    query = urllib.parse.urlencode({'filters[parentId][EQUALS]': execution['id'], 'filters[kind][EQUALS]': 'LOOP', 'size': 3})
    children = fetch('/executions/search?' + query)
    # The fixed fixture has two rows. Bound diagnostics even if an engine is faulty.
    for child in children.get('results', [])[:2]:
        member = fetch('/executions/' + child['id'])
        if 'id' in member:
            family.append(member)
    snapshots = []
    for member in family:
        task_outputs = {}
        tasks = [t for t in member.get('taskRunList', []) if t['taskId'] == 'collect_evidence' or t['state']['current'] == 'FAILED']
        for task in tasks[:3]:
            task_outputs[task['id']] = fetch('/outputs/tasks/' + member['id'] + '/' + task['id'])
        snapshots.append({'execution': member, 'logs': fetch('/logs/' + member['id']), 'task_outputs': task_outputs})
    serialized = json.dumps({'case': State.mode, 'loop_search': children, 'snapshots': snapshots}, indent=2)
    # These are invented fixture credentials, but diagnostics should not expose them.
    fixture_credentials = [MOCK_KEY, AUTH, AUTH.removeprefix('Basic '), 'LocalMockOnly123!']
    credentials_seen = any(value in serialized for value in fixture_credentials)
    for value in fixture_credentials:
        serialized = serialized.replace(value, '[fixture credential redacted]')
    diagnostics = json.loads(serialized)
    diagnostics['fixture_credentials_redacted'] = credentials_seen
    (ROOT / 'tests/last-failure-diagnostics.json').write_text(json.dumps(diagnostics, indent=2) + '\n')


def execute(mode):
    State.mode, State.calls, State.polls = mode, [], 0
    boundary = 'kestra-local-synthetic-test'
    fields = {'request_key': 'native-test-' + mode, 'synthetic': 'false' if mode == 'no_confirmation' else 'true'}
    body = ''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n' for key, value in fields.items()) + f'--{boundary}--\r\n'
    execution = api('/executions/company.sanctionskit/sanctionskit-batch-evidence', body.encode(), 'multipart/form-data; boundary=' + boundary, 'POST')
    execution_id = execution['id']
    deadline = time.monotonic() + 60
    while execution['state']['current'] not in ('SUCCESS', 'FAILED', 'KILLED', 'WARNING', 'CANCELLED'):
        assert time.monotonic() < deadline, 'Native execution exceeded test deadline'
        time.sleep(.25)
        execution = api('/executions/' + execution_id)
    return execution


def main():
    modes = os.getenv('KESTRA_TEST_CASES', 'success,rate_limited_once,mixed,all_failed,cancelled,no_confirmation,timeout,unauthorized,rate_limited,server_error,conflict,wrong_batch,wrong_environment,extra_page,row_order,unfinished,bad_uuid,wrong_evidence,wrong_contact,wrong_package,wrong_match_count,redirect,bad_batch_id,counter_mismatch').split(',')
    flow = (ROOT / 'sanctionskit-batch-evidence.yaml').read_text()
    # Only endpoint, polling interval and polling budget change for local tests.
    # Request bodies, evidence checks, HTTP limits and exports are unchanged.
    assert flow.count('https://www.sanctionskit.com/api/v1') == 1
    flow = flow.replace('https://www.sanctionskit.com/api/v1', 'http://127.0.0.1:28102/api/v1').replace('interval: PT2S', 'interval: PT0.1S').replace('maxIterations: 30', 'maxIterations: 3').replace('maxDuration: PT2M', 'maxDuration: PT10S')
    exists = any(f['id'] == 'sanctionskit-batch-evidence' and f['namespace'] == 'company.sanctionskit' for f in api('/flows/search?' + urllib.parse.urlencode({'filters[namespace][EQUALS]': 'company.sanctionskit', 'size': 100}))['results'])
    api('/flows/company.sanctionskit/sanctionskit-batch-evidence' if exists else '/flows', flow.encode(), 'application/x-yaml', 'PUT' if exists else 'POST')
    server = ThreadingHTTPServer(('127.0.0.1', 28102), Mock)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    records = []
    execution = None
    try:
        for mode in modes:
            execution = None
            execution = execute(mode)
            state = execution['state']['current']
            expected = 'SUCCESS' if mode in ('success', 'rate_limited_once', 'mixed', 'all_failed', 'cancelled') else 'FAILED'
            record = {'case': mode, 'execution_id': execution['id'], 'state': state, 'expected': expected, 'calls': State.calls, 'polls': State.polls}
            records.append(record)
            if state != expected:
                (ROOT / 'tests/last-failure.json').write_text(json.dumps(execution, indent=2))
                print(json.dumps(record), flush=True)
                raise AssertionError(f'{mode}: expected {expected}, got {state}; see last-failure.json')
            family = [execution]
            if any(t['taskId'] == 'collect_evidence' for t in execution.get('taskRunList', [])):
                query = urllib.parse.urlencode({'filters[parentId][EQUALS]': execution['id'], 'filters[kind][EQUALS]': 'LOOP', 'size': 100})
                children = api('/executions/search?' + query)
                index_deadline = time.monotonic() + 5
                while not children['results'] and time.monotonic() < index_deadline:
                    time.sleep(.25)
                    children = api('/executions/search?' + query)
                assert children['total'] <= 100, 'Unexpected iteration pagination'
                for child in children['results']:
                    family.append(api('/executions/' + child['id']))
                assert len(family) > 1, 'Expected native Loop iteration executions'
            record['loop_iterations_observed'] = len(family) - 1
            for member in family:
                logs = api('/logs/' + member['id'])
                assert MOCK_KEY not in json.dumps(logs), 'Mock key leaked into task logs'
                assert MOCK_KEY not in json.dumps(member), 'Mock key leaked into execution metadata'
                for task in member.get('taskRunList', []):
                    if task['state']['current'] == 'SUCCESS' and task['taskId'] in ('submit_batch', 'poll_batch', 'fetch_evidence'):
                        task_outputs = api('/outputs/tasks/' + member['id'] + '/' + task['id'])
                        assert MOCK_KEY not in json.dumps(task_outputs), 'Mock key leaked into HTTP outputs'

            if state == 'FAILED':
                expected_task = {
                    'no_confirmation': 'require_synthetic', 'timeout': 'wait_for_batch',
                    'unauthorized': 'submit_batch', 'rate_limited': 'submit_batch',
                    'server_error': 'submit_batch', 'conflict': 'submit_batch',
                    'wrong_batch': 'check_poll_identity', 'wrong_environment': 'check_poll_identity',
                    'extra_page': 'check_complete_page', 'row_order': 'check_complete_page',
                    'unfinished': 'check_row', 'bad_uuid': 'check_screening_id',
                    'wrong_evidence': 'check_evidence', 'wrong_contact': 'check_evidence',
                    'wrong_package': 'check_evidence', 'wrong_match_count': 'check_evidence',
                    'redirect': 'check_acceptance', 'bad_batch_id': 'check_acceptance',
                    'counter_mismatch': 'check_complete_page',
                }[mode]
                failed_tasks = [t['taskId'] for member in family for t in member.get('taskRunList', []) if t['state']['current'] == 'FAILED']
                assert expected_task in failed_tasks, (mode, expected_task, failed_tasks)
                record['intended_failure_task'] = expected_task
            record['mock_key_absent_from_logs_and_outputs'] = True
            if state == 'SUCCESS':
                outputs = api('/outputs/executions/' + execution['id'])
                assert MOCK_KEY not in json.dumps(outputs)
                for key in ['review_bundle', 'row_summary']:
                    uri = outputs[key]
                    payload = api('/executions/' + execution['id'] + '/file?path=' + urllib.parse.quote(uri, safe=''))
                    assert MOCK_KEY not in payload.decode()
                    if key == 'review_bundle':
                        bundle = json.loads(payload)
                        assert bundle['synthetic'] is True and bundle['onboardingApproved'] is False
                        count = {'success': 2, 'rate_limited_once': 2, 'mixed': 1, 'all_failed': 0, 'cancelled': 0}[mode]
                        assert len(bundle['evidenceByRow']) == count
                        assert len(bundle['batch']['rows']) == 2
                        for row, e in bundle['evidenceByRow'].items():
                            index = int(row) - 1
                            assert e['result']['id'] == IDS[index]
                            assert e['request'] == SUBJECTS[index]
                        if mode == 'success': (ROOT / 'synthetic-review-bundle.json').write_bytes(payload)
                    else:
                        rows = list(csv.DictReader(io.StringIO(payload.decode())))
                        assert len(rows) == 2 and [r['reference'] for r in rows] == [s['reference'] for s in SUBJECTS]
                        if mode == 'success': (ROOT / 'synthetic-row-summary.csv').write_bytes(payload)
            if mode == 'no_confirmation': assert not State.calls
            if mode in ('unauthorized', 'conflict'): assert len(State.calls) == 1
            if mode in ('rate_limited', 'server_error'): assert len(State.calls) == 2
            if mode == 'rate_limited_once':
                posts = [c for c in State.calls if c['method'] == 'POST']
                assert len(posts) == 2 and posts[0] == posts[1]
            if mode in ('bad_uuid', 'extra_page', 'row_order', 'wrong_batch', 'wrong_environment', 'timeout'): assert not any('/results/' in c['path'] for c in State.calls)
            if mode == 'timeout': assert State.polls == 3
            if mode in ('redirect', 'bad_batch_id'): assert len(State.calls) == 1
            if mode == 'counter_mismatch': assert not any('/results/' in c['path'] for c in State.calls)
            print(f'{mode}: {state}, {len(State.calls)} mock requests', flush=True)
    except Exception:
        if execution is not None:
            try:
                capture_failure(execution)
            except Exception as error:
                print(f'Failure diagnostics unavailable: {type(error).__name__}', flush=True)
        raise
    finally:
        server.shutdown()
        (ROOT / 'tests/native-results.json').write_text(json.dumps({'runtime': 'Kestra 2.0.4', 'plugin': 'io.kestra.plugin:plugin-serdes:2.0.6', 'java': 'Official Temurin 25 JRE image pinned by digest', 'boundary': 'Native engine against loopback fictional HTTP mock only', 'cases': records}, indent=2) + '\n')

if __name__ == '__main__':
    main()
