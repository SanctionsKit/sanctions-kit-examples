"""Download one pinned official Kestra runtime during image build."""
import hashlib
from pathlib import Path
import urllib.request

url = 'https://github.com/kestra-io/kestra/releases/download/v2.0.4/kestra-2.0.4'
expected = '88ee8d44c3d4a234c9d04689e72b8ba903ae8f9f2c6ae5f94bad89f3bcd68513'
path = Path('/opt/kestra/kestra-2.0.4')
path.parent.mkdir(parents=True, exist_ok=True)
with urllib.request.urlopen(url, timeout=60) as response, path.open('wb') as output:
    while chunk := response.read(1024 * 1024):
        output.write(chunk)
assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, 'Runtime checksum mismatch'
