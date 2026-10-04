type Sanctionskit = { api_key: string };
type JsonObject = Record<string, unknown>;

const api = "https://www.sanctionskit.com/api/v1";
const maxResponseBytes = 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Missing or invalid ${label}. No review result was produced.`,
    );
  }
  return value as JsonObject;
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  ) {
    throw new Error(
      `Check ${label}. It must contain ${min} to ${max} characters.`,
    );
  }
  return value.trim();
}

async function request(
  path: string,
  key: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${api}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        ...init.headers,
      },
    });
  } catch {
    throw new Error(
      "The API request did not complete. Retry with the same event ID and contact.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const retryAfter = response.headers.get("retry-after") ?? "";
    const retry =
      response.status === 429
        ? /^\d{1,6}$/.test(retryAfter)
          ? ` Retry after ${retryAfter} seconds.`
          : " Wait before retrying."
        : "";
    throw new Error(
      `SanctionsKit returned HTTP ${response.status}.${retry} No review result was produced.`,
    );
  }
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    await response.body?.cancel();
    throw new Error(
      "The API returned an unexpected content type. No review result was produced.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The API returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes)
        throw new Error("Response exceeds the example's 1 MiB limit.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error(
      "The API response was incomplete, invalid, or too large. No review result was produced.",
    );
  } finally {
    reader.releaseLock();
  }
}

function screening(value: unknown): JsonObject {
  const result = object(value, "screening result");
  const versions = object(result.versions, "result versions");
  if (
    typeof result.id !== "string" ||
    !uuid.test(result.id) ||
    result.environment !== "sandbox" ||
    versions.package !== "sandbox@1" ||
    !["potential_match", "no_match"].includes(String(result.status)) ||
    !Array.isArray(result.matches) ||
    !Array.isArray(result.coverage) ||
    !result.coverage.length ||
    typeof result.disclaimer !== "string" ||
    result.coverage.some(
      (source) => object(source, "coverage").sourceId !== "sandbox-synthetic",
    ) ||
    (result.status === "no_match" && result.matches.length !== 0) ||
    (result.status === "potential_match" && result.matches.length === 0)
  ) {
    throw new Error(
      "The response is not a complete synthetic screening result.",
    );
  }
  return result;
}

export async function main(
  sanctionskit: Sanctionskit,
  contact: { name: string; reference: string; birth_year?: string },
  event_id: string,
  synthetic: boolean = false,
) {
  if (synthetic !== true)
    throw new Error(
      "Confirm that this contact is fictional by setting synthetic to true.",
    );
  const credentials = object(sanctionskit, "SanctionsKit resource");
  const key = text(credentials.api_key, "the sandbox API key", 1, 512);
  if (/\s/.test(key))
    throw new Error("The sandbox API key must not contain whitespace.");
  const input = object(contact, "fictional contact");
  const name = text(input.name, "the fictional name", 2, 300);
  const reference = text(input.reference, "the onboarding reference", 1, 160);
  const eventId = text(event_id, "the event ID", 8, 128);
  if (!/^[\w:.-]+$/.test(eventId))
    throw new Error(
      "Use letters, numbers, underscores, colons, dots, or hyphens in the event ID.",
    );
  const subject: JsonObject = { name, entityType: "person" };
  if (input.birth_year !== undefined) {
    const year = text(input.birth_year, "the fictional birth year", 4, 4);
    if (!/^(?!0000)\d{4}$/.test(year))
      throw new Error("Use a four-digit fictional birth year other than 0000.");
    subject.birthDate = year;
  }
  const body = {
    subject,
    package: "sandbox@1",
    reference,
    retention: "standard",
  };
  const response = object(
    await request("/screenings", key, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": eventId,
      },
      body: JSON.stringify(body),
    }),
    "screening response",
  );
  const result = screening(response.data);
  const evidence = object(
    await request(`/results/${result.id}/evidence`, key, { method: "GET" }),
    "evidence",
  );
  const retained = screening(evidence.result);
  const retainedSubject = object(evidence.subject, "retained subject");
  if (
    evidence.format !== "sanctionskit-evidence@1" ||
    retained.id !== result.id ||
    retained.status !== result.status ||
    evidence.retention !== "standard" ||
    evidence.retainedInputs !== true ||
    evidence.reference !== reference ||
    retainedSubject.name !== name ||
    retainedSubject.entityType !== "person" ||
    (subject.birthDate !== undefined &&
      retainedSubject.birthDate !== subject.birthDate)
  ) {
    throw new Error(
      "Evidence does not belong to this completed screening and contact.",
    );
  }
  return {
    synthetic: true,
    onboardingReference: reference,
    screeningId: retained.id,
    status: retained.status,
    review: {
      required: true,
      decision: "not_made",
      nextStep:
        retained.status === "potential_match"
          ? "Review the candidate records and evidence. Do not approve onboarding from a name match."
          : "Review the selected coverage and your onboarding requirements. No match is not clearance.",
      dashboard:
        "https://www.sanctionskit.com/dashboard/results?environment=sandbox",
    },
    coverage: retained.coverage,
    versions: retained.versions,
    disclaimer: retained.disclaimer,
    result: retained,
    evidence,
  };
}
