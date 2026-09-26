import json
import os
import sys
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    api_key = os.environ.get("SANCTIONSKIT_API_KEY")
    request_key = os.environ.get("REQUEST_KEY")
    base_url = os.environ.get("SANCTIONSKIT_BASE_URL") or "https://www.sanctionskit.com/api/v1"
    if not api_key or not request_key:
        raise ValueError("Set SANCTIONSKIT_API_KEY and REQUEST_KEY.")

    body = {
        "subject": {"name": "Alex Morgan", "entityType": "person", "birthDate": "1984"},
        "package": "sandbox@1",
        "reference": "example-customer-001",
        "retention": "standard",
    }
    request = Request(
        base_url.rstrip("/") + "/screenings",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": request_key,
        },
    )
    with build_opener(NoRedirect()).open(request, timeout=30) as response:
        print(response.read().decode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        with error:
            print(f"HTTP {error.code}\n{error.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
