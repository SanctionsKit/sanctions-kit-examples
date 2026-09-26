#!/usr/bin/env python3
"""Run the examples against a local HTTP server. No API key is needed."""

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


ROOT = Path(__file__).resolve().parent.parent
COMMANDS = {
    "curl": ["bash", "curl/screen.sh"],
    "javascript": ["node", "javascript/screen.mjs"],
    "typescript": ["node", "typescript/screen.mts"],
    "python": [sys.executable, "python/screen.py"],
    "ruby": ["ruby", "ruby/screen.rb"],
    "php": ["php", "php/screen.php"],
    "go": ["go", "run", "."],
    "java": ["java", "java/Screening.java"],
    "csharp": [
        "dotnet", "run", "--project", "csharp/SanctionsKitExample.csproj",
        "--verbosity", "quiet",
    ],
}
PAYLOAD = {
    "subject": {"name": "Alex Morgan", "entityType": "person", "birthDate": "1984"},
    "package": "sandbox@1",
    "reference": "example-customer-001",
    "retention": "standard",
}
API_KEY = "sk_test_local_example"
REQUEST_KEY = "00000000-0000-4000-8000-000000000003"


class Handler(BaseHTTPRequestHandler):
    def read_body(self):
        if self.headers.get("Transfer-Encoding", "").lower() != "chunked":
            return self.rfile.read(int(self.headers.get("Content-Length", 0)))
        chunks = []
        while True:
            size = int(self.rfile.readline().split(b";", 1)[0], 16)
            if size == 0:
                while self.rfile.readline().strip():
                    pass
                return b"".join(chunks)
            chunks.append(self.rfile.read(size))
            self.rfile.read(2)

    def do_POST(self):
        self.server.requests.append({
            "method": self.command,
            "path": self.path,
            "headers": self.headers,
            "body": self.read_body(),
        })
        status = 200 if self.path == "/redirected" else self.server.response_status
        body = self.server.response_body.encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if status == 307:
            self.send_header("Location", "/redirected")
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST

    def log_message(self, *_args):
        pass


def run_example(language, base_url, missing=None):
    env = {key: value for key, value in os.environ.items()
           if not key.lower().endswith("_proxy")}
    env.update({
        "SANCTIONSKIT_API_KEY": API_KEY,
        "REQUEST_KEY": REQUEST_KEY,
        "SANCTIONSKIT_BASE_URL": base_url,
        "NO_PROXY": "127.0.0.1,localhost",
        "DOTNET_NOLOGO": "true",
        "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
        "DOTNET_SKIP_FIRST_TIME_EXPERIENCE": "1",
    })
    if missing:
        env.pop(missing)
    return subprocess.run(
        COMMANDS[language], cwd=ROOT / "go" if language == "go" else ROOT,
        env=env, capture_output=True, text=True, timeout=120,
    )


def require(condition, message, result=None):
    if not condition:
        if result:
            message += (f"\nExit: {result.returncode}\n"
                        f"stdout: {result.stdout}\nstderr: {result.stderr}")
        raise AssertionError(message)


def check_request(request):
    require(request["method"] == "POST", "Expected POST")
    require(request["path"] == "/api/v1/screenings", "Wrong API path")
    headers = request["headers"]
    require(headers.get("Authorization") == f"Bearer {API_KEY}", "Wrong bearer token")
    require(headers.get("Idempotency-Key") == REQUEST_KEY, "Request key changed")
    require(headers.get_content_type() == "application/json", "Wrong content type")
    require(json.loads(request["body"]) == PAYLOAD, "Wrong screening payload")


def check_language(language, server):
    base_url = f"http://127.0.0.1:{server.server_port}/api/v1"
    for status in ("potential_match", "no_match"):
        server.requests.clear()
        server.response_status = 201
        server.response_body = (ROOT / "tests" / "fixtures" / f"{status}.json").read_text()
        result = run_example(language, base_url)
        require(result.returncode == 0, f"{status}: expected success", result)
        require(json.loads(result.stdout) == json.loads(server.response_body),
                f"{status}: response body was changed", result)
        require(len(server.requests) == 1, "Expected exactly one request", result)
        check_request(server.requests[0])

    for status in (401, 429, 503, 307):
        server.requests.clear()
        server.response_status = status
        server.response_body = json.dumps({"error": {"code": f"test_{status}",
                                                     "message": "Local test response"}})
        result = run_example(language, base_url)
        require(result.returncode != 0, f"HTTP {status}: expected failure", result)
        require(server.response_body in result.stderr,
                f"HTTP {status}: missing error body on stderr", result)
        require(not result.stdout.strip(), f"HTTP {status}: unexpected stdout", result)
        require(len(server.requests) == 1,
                f"HTTP {status}: request was retried or redirected", result)
        check_request(server.requests[0])

    for missing in ("SANCTIONSKIT_API_KEY", "REQUEST_KEY"):
        server.requests.clear()
        result = run_example(language, base_url, missing=missing)
        require(result.returncode != 0, f"Missing {missing}: expected failure", result)
        require(missing in result.stderr, f"Missing {missing}: unclear error", result)
        require(not server.requests, f"Missing {missing}: sent an HTTP request", result)

    with socket.socket() as unavailable:
        unavailable.bind(("127.0.0.1", 0))
        port = unavailable.getsockname()[1]
        result = run_example(language, f"http://127.0.0.1:{port}/api/v1")
    require(result.returncode != 0, "Connection failure: expected failure", result)
    require(result.stderr.strip(), "Connection failure: missing error", result)
    print(f"PASS {language}: success, HTTP errors, redirects, configuration, connection failure")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("languages", nargs="+", choices=[*COMMANDS, "all"])
    args = parser.parse_args()
    languages = list(COMMANDS) if "all" in args.languages else list(dict.fromkeys(args.languages))
    missing = [COMMANDS[name][0] for name in languages if not shutil.which(COMMANDS[name][0])]
    if missing:
        parser.error("Missing runtimes: " + ", ".join(dict.fromkeys(missing)))

    server = HTTPServer(("127.0.0.1", 0), Handler)
    server.requests = []
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    failures = []
    try:
        for language in languages:
            try:
                check_language(language, server)
            except (AssertionError, ValueError, subprocess.TimeoutExpired, OSError) as error:
                failures.append(language)
                print(f"FAIL {language}: {error}", file=sys.stderr)
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
