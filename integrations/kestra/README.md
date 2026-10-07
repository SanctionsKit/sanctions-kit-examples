# Kestra batch screening and evidence

This Kestra 2.0.4 flow submits two fictional contacts to the SanctionsKit synthetic
sandbox, waits for the batch to finish, and collects retained evidence with a CSV
row summary. Completed, failed and cancelled rows stay visible. A successful
collection does not approve onboarding or mean that every row screened successfully.

All 24 native fixture scenarios passed on Kestra 2.0.4 with serdes 2.0.6 and
Temurin 25 in an isolated container. The [verified CI run](https://github.com/SanctionsKit/sanctions-kit-examples/actions/runs/37181224466)
used a local fictional HTTP server with Docker networking disabled. This verifies
the workflow and its error handling against fixtures; a hosted sandbox run remains
separate.

## Isolated fixture test

The CI job builds an image from official Python and Eclipse Temurin images pinned
by digest, downloads Kestra 2.0.4 with a checked SHA-256, and installs serdes 2.0.6
with a checked artifact hash. [runtime-lock.json](runtime-lock.json) records these
sources. Network access is needed only while building the image.

Execution uses Docker `--network none`, with no published ports or Docker socket.
The fixed hostname resolves to `127.0.0.1` through the container's hosts file, so
Java can identify the local host without DNS. The test runner checks that mapping
and refuses to start unless its only network interface is `lo`. It
runs as an unprivileged user with all Linux capabilities dropped, no new privileges,
a read-only root filesystem, and temporary writable directories. The only service
key is the invented string `local-mock-only`; no GitHub secret or real API key is
needed. No hosted SanctionsKit request can leave the container.

From this directory on a machine with Docker:

```sh
docker build -f tests/Dockerfile -t sanctionskit-kestra-fixture .
mkdir -p test-results
docker run --rm --network none --cap-drop ALL \
  --hostname kestra-fixture --add-host kestra-fixture:127.0.0.1 \
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
`test-results/`. A failed assertion also saves bounded parent and Loop task logs
and outputs, with fixture credentials redacted. A parser or import pass is not
a substitute for this run.

## Sandbox setup

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
