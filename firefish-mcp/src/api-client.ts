/**
 * Firefish Public API Client
 * Handles OAuth2 client_credentials token refresh and HTTP requests.
 * Base URL: https://api.firefishsoftware.com
 * Auth: OAuth2 client_credentials — token auto-refreshes before expiry.
 */

export interface FirefishConfig {
  /** OAuth2 client_id (e.g. "Ceek-JobsAPI-ApiDetails") */
  clientId: string;
  /** OAuth2 client_secret */
  clientSecret: string;
  /** OAuth2 scopes (default: "jobsAPI-read jobsAPI-write") */
  scope?: string;
  /** Override the API base URL (default: https://api.firefishsoftware.com) */
  baseUrl?: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class FirefishApiClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scope: string;

  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0; // epoch ms

  constructor(config: FirefishConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.scope = config.scope || "jobsAPI-read jobsAPI-write";
    this.baseUrl = (config.baseUrl || "https://api.firefishsoftware.com").replace(
      /\/$/,
      ""
    );
  }

  /**
   * Fetch a fresh Bearer token from the Firefish auth endpoint.
   * Tokens last ~10 minutes (599s). We refresh 60s before expiry.
   * Also retries on 401 responses.
   */
  private async refreshToken(): Promise<void> {
    const now = Date.now();

    // Skip if token is still valid (with 60s buffer)
    if (this.accessToken && now < this.tokenExpiresAt - 60_000) {
      return;
    }

    const url = `${this.baseUrl}/authorization/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Token refresh failed (HTTP ${response.status}): ${text.substring(0, 300)}`
      );
    }

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + data.expires_in * 1000;

    console.error(
      `[firefish] Token refreshed — expires in ${data.expires_in}s`
    );
  }

  private async getHeaders(): Promise<Record<string, string>> {
    await this.refreshToken();
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return this.request<T>("GET", url);
  }

  async post<T = unknown>(
    path: string,
    body: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>("POST", url, body);
  }

  async patch<T = unknown>(
    path: string,
    body: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>("PATCH", url, body);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    try {
      const headers = await this.getHeaders();
      const options: RequestInit = {
        method,
        headers,
      };
      if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const text = await response.text();

      // If 401, force token refresh and retry once
      if (response.status === 401) {
        console.error("[firefish] Got 401 — forcing token refresh and retrying");
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        const retryHeaders = await this.getHeaders();
        const retryOptions: RequestInit = { method, headers: retryHeaders };
        if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
          retryOptions.body = JSON.stringify(body);
        }
        const retryResponse = await fetch(url, retryOptions);
        const retryText = await retryResponse.text();
        if (!retryResponse.ok) {
          return {
            ok: false,
            status: retryResponse.status,
            error: `HTTP ${retryResponse.status}: ${retryText.substring(0, 500)}`,
          };
        }
        let data: T | undefined;
        if (retryText) {
          try { data = JSON.parse(retryText) as T; } catch { data = retryText as unknown as T; }
        }
        return { ok: true, status: retryResponse.status, data };
      }

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorJson = JSON.parse(text);
          errorMessage = errorJson.message || errorJson.error || errorJson.Message || errorJson.ExceptionMessage || errorMessage;
          // Capture full error detail for 500 errors
          if (response.status >= 500) {
            const detail = errorJson.ExceptionMessage || errorJson.StackTrace || errorJson.InnerException || text.substring(0, 800);
            console.error(`[firefish] Server error detail: ${detail}`);
            errorMessage += ` | Detail: ${String(detail).substring(0, 300)}`;
          }
        } catch {
          if (text) {
            errorMessage += ` - ${text.substring(0, 500)}`;
            if (response.status >= 500) {
              console.error(`[firefish] Raw 500 body: ${text.substring(0, 800)}`);
            }
          }
        }
        return { ok: false, status: response.status, error: errorMessage };
      }

      let data: T | undefined;
      if (text) {
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = text as unknown as T;
        }
      }

      return { ok: true, status: response.status, data };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error occurred";
      return { ok: false, status: 0, error: message };
    }
  }
}
