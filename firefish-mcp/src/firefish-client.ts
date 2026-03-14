/**
 * Firefish API Client
 * Handles OAuth 2.0 client_credentials flow with automatic token refresh.
 * Tokens expire every 10 minutes — this client caches and auto-renews them.
 */

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
}

interface FirefishConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string; // https://api.firefishsoftware.com
}

// ── Token cache (in-memory, refreshed automatically) ──────────────────────────
let tokenCache: TokenCache | null = null;

async function getAccessToken(config: FirefishConfig): Promise<string> {
  const now = Date.now();
  const bufferMs = 60_000; // Refresh 1 minute before expiry

  if (tokenCache && tokenCache.expiresAt - bufferMs > now) {
    return tokenCache.accessToken;
  }

  // Request new token via OAuth client_credentials
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: [
      "candidatesAPI-read",
      "companiesAPI-read",
      "jobsAPI-read",
      "placementdetailsAPI-read",
      "actionsAPI-read",
      "contactsAPI-read",
    ].join(" "),
  });

  const response = await fetch(`${config.baseUrl}/authorization/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firefish auth failed (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    access_token: string;
    expires_in: number;
  };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

// ── Generic API request helper ────────────────────────────────────────────────
export async function firefishRequest<T>(
  config: FirefishConfig,
  endpoint: string,
  params: Record<string, string | number | boolean> = {}
): Promise<T> {
  const token = await getAccessToken(config);

  const url = new URL(`${config.baseUrl}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firefish API error ${response.status} on ${endpoint}: ${error}`);
  }

  return response.json() as Promise<T>;
}

export type { FirefishConfig };
