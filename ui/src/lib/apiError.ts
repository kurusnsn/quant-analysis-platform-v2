const MAX_ERROR_LEN = 240;

const sanitize = (value: string) => {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_ERROR_LEN) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_ERROR_LEN)}...`;
};

export async function readApiErrorMessage(
  response: Response,
  fallback = "Request failed."
) {
  const bodyText = await response.text().catch(() => "");
  if (!bodyText) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const candidate = parsed.error ?? parsed.message ?? parsed.detail;
    if (typeof candidate === "string" && candidate.trim()) {
      return sanitize(candidate);
    }
  } catch {
    // Ignore invalid JSON and use text fallback.
  }

  const normalized = sanitize(bodyText);
  return normalized || fallback;
}
