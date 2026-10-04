# Kestra 2.0 batch-screening candidate

This is a candidate for native fixture testing on Kestra 2.0.4. It has passed the
2.0.4 server's flow import validation. It has not yet passed native execution on
that version, so it is not ready to use as a published integration.

The flow submits two fictional contacts to the SanctionsKit synthetic sandbox,
waits for the batch to finish, and collects retained evidence with a CSV row
summary. Completed, failed and cancelled rows stay visible. A successful collection
does not approve onboarding or mean that every row screened successfully.

The maintenance-version implementation passed 24 native mock scenarios on Kestra
1.3.41. That result does not establish 2.0 compatibility. This candidate replaces
`ForEach` with `Loop`, uses explicit per-iteration outputs, removes `pluginDefaults`,
updates the boolean input and HTTP timeout fields, and uses the 2.0 output API in
the tests. Native execution is the next gate.

## Isolated fixture test

The CI job builds an image from official Python and Eclipse Temurin images pinned
by digest, downloads Kestra 2.0.4 with a checked SHA-256, and installs serdes 2.0.6
with a checked artifact hash. [runtime-lock.json](runtime-lock.json) records these
sources. Network access is needed only while building the image.

Execution uses Docker `--network none`, with no published ports or Docker socket.
The test runner refuses to start unless its only network interface is `lo`. It
runs as an unprivileged user with all Linux capabilities dropped, no new privileges,
a read-only root filesystem, and temporary writable directories. The only service
key is the invented string `local-mock-only`; no GitHub secret or real API key is
needed. No hosted SanctionsKit request can leave the container.

From this directory on a machine with Docker:

```sh
docker build -f tests/Dockerfile -t sanctionskit-kestra-fixture .
mkdir -p test-results
docker run --rm --network none --cap-drop ALL \
  --security-opt no-new-privileges:true --read-only \
  --memory 3g --cpus 2 --pids-limit 512 \
  --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,nosuid,nodev,size=1g,mode=1777 \
  --tmpfs /work:rw,nosuid,nodev,size=1g,mode=1777 \
  --mount "type=bind,source=$PWD/test-results,target=/evidence" \
  sanctionskit-kestra-fixture
```

The fixture imports the actual flow and changes only the API host, polling interval
and polling budget. Request bodies, evidence checks, HTTP limits and exports stay
unchanged. It expects all 24 scenarios to pass, including completion, rate-limit
retry, failed/cancelled rows, timeouts, HTTP errors, unsafe IDs, mismatched evidence,
pagination, row order and counters. It checks the parent execution and native Loop
iteration executions, uses the 2.0 outputs API, downloads the JSON/CSV files, and
checks logs and outputs for the fake key.

The server log, per-case results, isolation report and generated files go into
`test-results/`. A parser or import pass is not a substitute for this run.

## Intended sandbox setup after qualification

Create a free [developer workspace](https://www.sanctionskit.com/signup?workflow=api)
and a sandbox key with `batches:write` and `results:read`. Save the key as the Kestra
secret `SANCTIONSKIT_API_KEY`. The sandbox uses synthetic records and needs no card.
Production screening needs a plan and payment method.

The two fixed contacts keep their partial birth years as strings. Each row requests
`sandbox@1` and standard retention. Use a fresh `request_key` for a new business
batch and the same key/body for retries. Redirects are disabled. A 202 only confirms
acceptance; the bounded loop waits for a terminal batch state.

This starter expects one complete ordered page. Unexpected pagination, counters,
IDs, contacts or retained requests stop the flow. It fetches same-ID evidence only
for completed rows and preserves unsuccessful row outcomes. A `potential_match`
needs review; `no_match` means no candidates within the selected coverage and
matching rules. Neither is an account approval or legal clearance.

The daily trigger is disabled. Before adapting this to larger inputs or enabling
scheduling, read the [batch API guide](https://www.sanctionskit.com/docs/batches) and
choose a durable business-batch key. No external notifications, account decisions
or database writes are part of this example.

No Kestra catalog submission or placement is claimed. Upstream blueprint licensing
and catalog acceptance remain separate from company source publication.
