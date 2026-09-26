const apiKey = process.env.SANCTIONSKIT_API_KEY;
const requestKey = process.env.REQUEST_KEY;
const baseUrl = process.env.SANCTIONSKIT_BASE_URL || "https://www.sanctionskit.com/api/v1";

try {
  if (!apiKey || !requestKey) {
    throw new Error("Set SANCTIONSKIT_API_KEY and REQUEST_KEY.");
  }

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/screenings`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": requestKey,
    },
    body: JSON.stringify({
      subject: { name: "Alex Morgan", entityType: "person", birthDate: "1984" },
      package: "sandbox@1",
      reference: "example-customer-001",
      retention: "standard",
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}\n${body}`);
  }
  console.log(body);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
