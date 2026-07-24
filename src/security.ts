const RESOURCE_AWARE_PATHS = new Set([
  "/authorize",
  "/token",
  "/oauth2/authorize",
  "/oauth2/token",
]);

export async function hasUnsupportedResourceIndicator(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  if (!RESOURCE_AWARE_PATHS.has(url.pathname)) return false;
  if (url.searchParams.has("resource")) return true;
  if (request.method !== "POST") return false;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      return (await request.clone().formData()).has("resource");
    }
    if (contentType.includes("application/json")) {
      const body = (await request.clone().json()) as Record<string, unknown>;
      return Object.prototype.hasOwnProperty.call(body, "resource");
    }
  } catch {
    // Malformed request bodies are handled by the OAuth endpoint itself.
  }
  return false;
}

export function unsupportedResourceResponse(): Response {
  return Response.json(
    {
      error: "invalid_request",
      error_description: "RFC 8707 resource indicators are not supported by this issuer.",
    },
    { status: 400 },
  );
}
