"""Run the engine and fixture tests inside a network-none disposable container."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

# A network-none Linux container has only loopback. Refuse any other interface.
interfaces = sorted(p.name for p in Path('/sys/class/net').iterdir())
assert interfaces == ['lo'], f'Expected isolated loopback-only container, got {interfaces}'
assert os.geteuid() != 0, 'Run the test container as an unprivileged user'
hostname = socket.gethostname()
assert hostname == 'kestra-fixture', 'Run the test container with --hostname kestra-fixture'
hostname_addresses = sorted({address[4][0] for address in socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)})
assert hostname_addresses == ['127.0.0.1'], f'Expected hostname to resolve only to loopback, got {hostname_addresses}'
root = Path('/work/example')
shutil.copytree('/opt/example', root)
work = Path('/work/runtime')
work.mkdir()
log = Path('/evidence/kestra-server.log')
config = root / 'tests/local-kestra.yml'
command = ['java', '-Xmx1g', '-Djava.awt.headless=true', '-Duser.home=/work/runtime', '-jar', '/opt/kestra/kestra-2.0.4', 'server', 'local', '-c', str(config), '-p', '/opt/kestra/plugins', '--port=28101', '--worker-thread=4', '--no-tutorials']
env = dict(os.environ, SECRET_SANCTIONSKIT_API_KEY='bG9jYWwtbW9jay1vbmx5')
result = 1
with log.open('w') as stream:
    process = subprocess.Popen(command, cwd=work, env=env, stdout=stream, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 120
        while True:
            assert process.poll() is None, 'Kestra exited before readiness'
            assert time.monotonic() < deadline, 'Kestra readiness timed out'
            try:
                with urllib.request.urlopen('http://127.0.0.1:28101/ping', timeout=2) as response:
                    if response.status == 200:
                        break
            except (OSError, urllib.error.URLError):
                time.sleep(1)
        result = subprocess.run([sys.executable, str(root / 'tests/native_test.py')], cwd=root, timeout=360).returncode
    finally:
        process.terminate()
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        for name in ['tests/native-results.json', 'tests/last-failure.json', 'synthetic-review-bundle.json', 'synthetic-row-summary.csv']:
            source = root / name
            if source.exists():
                shutil.copy2(source, Path('/evidence') / source.name)
        report = {'network_interfaces': interfaces, 'hostname': hostname, 'hostname_addresses': hostname_addresses, 'runtime': 'Kestra2.0.4', 'fixture_tests_exit': result, 'hosted_api_calls': 0, 'service_credentials_used': False}
        Path('/evidence/container-boundary.json').write_text(json.dumps(report, indent=2) + '\n')
        # The only key involved is fake, but logs still must not expose it.
        assert 'local-mock-only' not in log.read_text(), 'Mock key leaked to server log'
sys.exit(result)
