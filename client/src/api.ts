import { Capacitor } from '@capacitor/core';
import { t, type Lang } from './i18n';

// Small fetch wrapper for the pharmacy backend. The backend address follows
// the page's own host: on the computer itself that is localhost, and on a
// phone over Wi-Fi it is the computer's network address — so the same build
// works on both without any setting.
//
// Inside the Android app the page runs in a WebView whose own host is the
// phone itself, so the computer's address must be entered once (on the login
// screen) and is then remembered here. A stored address always wins.
const SERVER_KEY = 'pharmacy_server_host';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function getStoredServerHost(): string {
  return localStorage.getItem(SERVER_KEY) || '';
}

export function getServerHost(): string {
  return getStoredServerHost() || window.location.hostname;
}

export function setServerHost(host: string): void {
  const h = host.trim();
  if (h) localStorage.setItem(SERVER_KEY, h);
  else localStorage.removeItem(SERVER_KEY);
}

function base(): string {
  return `http://${getServerHost()}:5000/api`;
}

const TOKEN_KEY = 'pharmacy_token';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

// The UI language the user last chose (same key App.tsx stores it
// under); the server-down message below is shown in that language.
function serverLang(): Lang {
  const saved = localStorage.getItem('pharmacy_lang');
  return saved === 'en' || saved === 'fa' || saved === 'ps' ? saved : 'ps';
}

// Throw an HTTP error carrying its status, so callers can tell a 401
// (invalid token) from any other failure. A 401 while a token is stored
// means the session is dead (e.g. the user was deactivated mid-session):
// tell the app to drop the session and show the login screen again.
function throwHttp(status: number, message: string): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  if (status === 401 && getToken()) {
    window.dispatchEvent(new Event('pharmacy-unauthorized'));
  }
  throw err;
}

// fetch() throws a TypeError before any HTTP status exists when the
// server cannot be reached at all — map that to the translated
// "server down" message instead of leaking "Failed to fetch" verbatim
// into every page's error box (Login already mapped it; now all do).
async function req(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(t(serverLang(), 'serverDown'));
  }
}

async function handle(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throwHttp(res.status, (data && data.message) || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  async get(path: string) {
    const res = await req(base() + path, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    return handle(res);
  },
  async post(path: string, body: unknown, withToken = true) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (withToken) headers.Authorization = `Bearer ${getToken()}`;
    const res = await req(base() + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return handle(res);
  },
  // Download a file from the API (needs the token, so a plain link won't do).
  // Returns the file name the browser saved it under.
  async download(path: string, fallbackName: string) {
    const res = await req(base() + path, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throwHttp(res.status, (data && data.message) || `HTTP ${res.status}`);
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
  // Fetch a file as a blob (the caller decides where it goes — e.g. the
  // browser's Save dialog). Returns the blob plus the server's file name.
  async downloadBlob(path: string, fallbackName: string) {
    const res = await req(base() + path, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throwHttp(res.status, (data && data.message) || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(cd);
    return { blob, name: match ? match[1] : fallbackName };
  },
  async put(path: string, body: unknown) {
    const res = await req(base() + path, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify(body),
    });
    return handle(res);
  },
  async patch(path: string, body: unknown) {
    const res = await req(base() + path, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify(body),
    });
    return handle(res);
  },
  async del(path: string) {
    const res = await req(base() + path, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    return handle(res);
  },
  // POST a raw text body (used to upload a .sql backup for restore).
  async postText(path: string, text: string) {
    const res = await req(base() + path, {
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
