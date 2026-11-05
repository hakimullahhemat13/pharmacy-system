import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import { type Lang, LANG_NAMES, dirFor, t } from './i18n';

interface User {
  id: string;
  full_name: string;
  username: string;
  role: string;
  language: string;
}

interface Summary {
  sales_count: number;
  items_sold: number;
  revenue: number;
  cost_total: number;
  discount_total: number;
  profit: number;
}

interface Batch {
  batch_id: string;
  batch_no: string;
  expiry_date: string;
  quantity_on_hand: number;
  medicine_name: string;
  days_remaining: number;
  level: 'expired' | 'critical' | 'warning';
}

interface StockRow {
  medicine_id: string;
  name: string;
  total_quantity: number;
  low_stock: boolean;
}

type Page = 'dashboard' | 'medicines' | 'sales' | 'purchases' | 'reports';

const USER_KEY = 'pharmacy_user';
const LANG_KEY = 'pharmacy_lang';

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function loadLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === 'en' || saved === 'fa' || saved === 'ps' ? saved : 'ps';
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US');
}

function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="lang-switch">
      {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
        <button key={l} className={l === lang ? 'active' : ''} onClick={() => setLang(l)}>
          {LANG_NAMES[l]}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => (getToken() ? loadUser() : null));
  const [lang, setLangState] = useState<Lang>(loadLang);
  const [page, setPage] = useState<Page>('dashboard');

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirFor(lang);
  }, [lang]);

  const logout = () => {
    setToken(null);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  if (!user) {
    return (
      <Login
        lang={lang}
        setLang={setLang}
        onLogin={(u, token) => {
          setToken(token);
          localStorage.setItem(USER_KEY, JSON.stringify(u));
          if (u.language === 'en' || u.language === 'fa' || u.language === 'ps') {
            setLang(u.language as Lang);
          }
          setUser(u);
        }}
      />
    );
  }

  const menu: { key: Page; label: string }[] = [
    { key: 'dashboard', label: t(lang, 'dashboard') },
    { key: 'medicines', label: t(lang, 'medicines') },
    { key: 'sales', label: t(lang, 'sales') },
    { key: 'purchases', label: t(lang, 'purchases') },
    { key: 'reports', label: t(lang, 'reports') },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">💊 {t(lang, 'appName')}</div>
        {menu.map((m) => (
          <button
            key={m.key}
            className={`nav${page === m.key ? ' active' : ''}`}
            onClick={() => setPage(m.key)}
          >
            {m.label}
          </button>
        ))}
        <div className="spacer" />
        <div className="user-box">
          👤 {user.full_name}
          <br />
          <span className="muted">{user.username} · {user.role}</span>
        </div>
        <button className="logout" onClick={logout}>
          {t(lang, 'logout')}
        </button>
      </aside>
      <main className="main">
        {page === 'dashboard' ? (
          <Dashboard lang={lang} />
        ) : (
          <>
            <h2>{menu.find((m) => m.key === page)?.label}</h2>
            <div className="panel">
              <p className="muted" style={{ fontSize: 15 }}>
                🚧 {t(lang, 'comingSoon')}
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Login({
  lang,
  setLang,
  onLogin,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  onLogin: (user: User, token: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api.post('/auth/login', { username, password }, false);
      onLogin(data.user as User, data.token as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(
        msg === 'Invalid username or password'
          ? t(lang, 'loginFailed')
          : msg === 'Failed to fetch'
            ? t(lang, 'serverDown')
            : msg || t(lang, 'loginFailed')
      );
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <LangSwitch lang={lang} setLang={setLang} />
        <div className="logo">💊</div>
        <h1>{t(lang, 'appName')}</h1>
        <label htmlFor="username">{t(lang, 'username')}</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <label htmlFor="password">{t(lang, 'password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <div className="error-box">{error}</div>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? t(lang, 'loading') : t(lang, 'login')}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ lang }: { lang: Lang }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [daily, expiring, stockRes] = await Promise.all([
          api.get('/reports/daily'),
          api.get('/stock/expiring?months=3'),
          api.get('/stock'),
        ]);
        if (!alive) return;
        setSummary(daily.summary as Summary);
        setBatches(expiring.batches as Batch[]);
        setStock(stockRes.stock as StockRow[]);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Error');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const lowCount = stock.filter((s) => s.low_stock).length;
  const levelLabel = (level: Batch['level']) =>
    level === 'expired'
      ? t(lang, 'levelExpired')
      : level === 'critical'
        ? t(lang, 'levelCritical')
        : t(lang, 'levelWarning');

  return (
    <>
      <h2>{t(lang, 'dashboard')}</h2>
      {error && <div className="error-box">{error}</div>}
      {!summary && !error && <p className="muted">{t(lang, 'loading')}</p>}
      {summary && (
        <div className="cards">
          <div className="card">
            <div className="card-label">{t(lang, 'todayRevenue')}</div>
            <div className="card-value">{fmt(summary.revenue)}</div>
            <div className="card-sub">{t(lang, 'currency')}</div>
          </div>
          <div className="card profit">
            <div className="card-label">{t(lang, 'todayProfit')}</div>
            <div className="card-value">{fmt(summary.profit)}</div>
            <div className="card-sub">{t(lang, 'currency')}</div>
          </div>
          <div className="card">
            <div className="card-label">{t(lang, 'todayBills')}</div>
            <div className="card-value">{fmt(summary.sales_count)}</div>
            <div className="card-sub">
              {t(lang, 'itemsSold')}: {fmt(summary.items_sold)}
            </div>
          </div>
          <div className="card">
            <div className="card-label">{t(lang, 'totalMedicines')}</div>
            <div className="card-value">{fmt(stock.length)}</div>
            <div className="card-sub">
              {t(lang, 'lowStock')}: {fmt(lowCount)}
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <h3>⚠️ {t(lang, 'expiryWarnings')}</h3>
        {batches.length === 0 ? (
          <p className="empty-note">{t(lang, 'noWarnings')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'medicine')}</th>
                <th>{t(lang, 'batch')}</th>
                <th>{t(lang, 'expiryDate')}</th>
                <th>{t(lang, 'daysLeft')}</th>
                <th>{t(lang, 'qty')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batch_id} className={b.level === 'expired' ? 'row-expired' : ''}>
                  <td>{b.medicine_name}</td>
                  <td>{b.batch_no}</td>
                  <td>{String(b.expiry_date).slice(0, 10)}</td>
                  <td>{b.days_remaining}</td>
                  <td>{b.quantity_on_hand}</td>
                  <td>
                    <span className={`badge ${b.level}`}>{levelLabel(b.level)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
