function getApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  try {
    // Safe dynamic resolution in Expo Go runtime
    const Constants = require('expo-constants')?.default;
    const hostUri =
      Constants?.expoConfig?.hostUri ||
      Constants?.manifest?.debuggerHost ||
      Constants?.manifest2?.extra?.expoClient?.hostUri ||
      '';

    if (hostUri) {
      const ip = hostUri.split(':')[0];
      if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
        return `http://${ip}:3001`;
      }
    }
  } catch {
    // Node / Vitest fallback
  }

  return 'http://192.168.29.44:3001';
}

export const API_BASE_URL = getApiBaseUrl();

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const timeoutMs = options.timeoutMs || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `HTTP Error ${res.status}`;
      try {
        const json = JSON.parse(errText);
        errMsg = json.message || errMsg;
      } catch {
        if (errText) errMsg = errText;
      }
      return { data: null, error: errMsg, status: res.status };
    }

    const json = (await res.json()) as T;
    return { data: json, error: null, status: res.status };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const msg = err.name === 'AbortError' ? 'Network request timed out' : err.message || 'Network error';
    return { data: null, error: msg, status: 0 };
  }
}
