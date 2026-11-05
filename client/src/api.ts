// Small fetch wrapper for the pharmacy backend (http://localhost:5000/api).
const BASE = 'http://localhost:5000/api';

const TOKEN_KEY = 'pharmacy_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function handle(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && data.message) || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  async get(path: string) {
    const res = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    return handle(res);
  },
  async post(path: string, body: unknown, withToken = true) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (withToken) headers.Authorization = `Bearer ${getToken()}`;
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return handle(res);
  },
};
