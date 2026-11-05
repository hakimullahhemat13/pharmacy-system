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
  // Download a file from the API (needs the token, so a plain link won't do).
  // Returns the file name the browser saved it under.
  async download(path: string, fallbackName: string) {
    const res = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data && data.message) || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(cd);
    const name = match ? match[1] : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return name;
  },
  // POST a raw text body (used to upload a .sql backup for restore).
  async postText(path: string, text: string) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/sql',
      },
      body: text,
    });
    return handle(res);
  },
};
