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
  generic_name: string | null;
  barcode: string | null;
  unit: string;
  sale_price: number | string;
  min_stock: number;
  total_quantity: number;
  batch_count: number;
  low_stock: boolean;
}

interface SaleItemDetail {
  item_id: string;
  medicine_id: string;
  medicine_name: string;
  batch_id: string;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  unit_price: number | string;
  cost_price: number | string;
  returned_quantity: number;
}

interface SaleDetail {
  id: string;
  invoice_no: string;
  sale_date: string;
  total_amount: number | string;
  discount: number | string;
  net_total: number | string;
  customer_name: string | null;
  items: SaleItemDetail[];
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

interface CustomerFull extends Customer {
  created_at: string;
}

interface CustomerHistorySale {
  id: string;
  invoice_no: string;
  sale_date: string;
  net_total: number | string;
  items: number;
}

interface BillItem {
  medicine_id: string;
  name: string;
  unit_price: number;
  quantity: number;
}

interface SaleRow {
  id: string;
  invoice_no: string;
  sale_date: string;
  net_total: number | string;
  customer_name: string | null;
}

interface MedOption {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
}

interface PurchaseRow {
  id: string;
  invoice_no: string | null;
  purchase_date: string;
  total_amount: number | string;
  paid_amount: number | string;
  supplier_name: string | null;
}

interface PurchaseItemDraft {
  medicine_id: string;
  batch_no: string;
  expiry_date: string;
  quantity: string;
  purchase_price: string;
}

interface DayRow {
  day: string;
  sales_count: number;
  revenue: number;
  cost_total: number;
  profit: number;
}

interface MonthRow {
  month: number;
  sales_count: number;
  revenue: number;
  cost_total: number;
  profit: number;
}

type Page = 'dashboard' | 'medicines' | 'sales' | 'purchases' | 'reports' | 'customers' | 'backup' | 'settings';

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
    { key: 'customers', label: t(lang, 'customers') },
    { key: 'settings', label: t(lang, 'settings') },
    ...(user.role === 'admin' ? [{ key: 'backup' as Page, label: t(lang, 'backup') }] : []),
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
        {page === 'dashboard' && <Dashboard lang={lang} />}
        {page === 'medicines' && <Medicines lang={lang} />}
        {page === 'sales' && <SalesPage lang={lang} />}
        {page === 'purchases' && <PurchasesPage lang={lang} />}
        {page === 'reports' && <ReportsPage lang={lang} />}
        {page === 'customers' && <CustomersPage lang={lang} />}
        {page === 'backup' && <BackupPage lang={lang} onLogout={logout} />}
        {page === 'settings' && <SettingsPage lang={lang} user={user} setLang={setLang} />}
        {page !== 'dashboard' && page !== 'medicines' && page !== 'sales' && page !== 'purchases' && page !== 'reports' && page !== 'customers' && page !== 'backup' && page !== 'settings' && (
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

function Medicines({ lang }: { lang: Lang }) {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    generic_name: '',
    company: '',
    barcode: '',
    unit: 'tablet',
    category: '',
    sale_price: '',
    min_stock: '10',
  });

  const load = async () => {
    const data = await api.get('/stock');
    setRows(data.stock as StockRow[]);
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Error'));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      (r.generic_name || '').toLowerCase().includes(q) ||
      (r.barcode || '').toLowerCase().includes(q)
  );
  const barcodeExact = query.trim();

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!form.name.trim()) {
      setError(t(lang, 'nameRequired'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/medicines', {
        name: form.name.trim(),
        generic_name: form.generic_name.trim() || undefined,
        company: form.company.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        unit: form.unit.trim() || undefined,
        category: form.category.trim() || undefined,
        sale_price: form.sale_price === '' ? undefined : Number(form.sale_price),
        min_stock: form.min_stock === '' ? undefined : Number(form.min_stock),
      });
      setMsg(t(lang, 'added'));
      setForm({
        name: '',
        generic_name: '',
        company: '',
        barcode: '',
        unit: 'tablet',
        category: '',
        sale_price: '',
        min_stock: '10',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setBusy(false);
  };

  return (
    <>
      <h2>{t(lang, 'medicines')}</h2>

      <div className="panel" style={{ marginTop: 0 }}>
        <h3>➕ {t(lang, 'addMedicine')}</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'name')} *</label>
              <input value={form.name} onChange={set('name')} />
            </div>
            <div className="field">
              <label>{t(lang, 'genericName')}</label>
              <input value={form.generic_name} onChange={set('generic_name')} />
            </div>
            <div className="field">
              <label>{t(lang, 'company')}</label>
              <input value={form.company} onChange={set('company')} />
            </div>
            <div className="field">
              <label>{t(lang, 'barcodeLabel')}</label>
              <input value={form.barcode} onChange={set('barcode')} />
            </div>
            <div className="field">
              <label>{t(lang, 'unit')}</label>
              <input value={form.unit} onChange={set('unit')} />
            </div>
            <div className="field">
              <label>{t(lang, 'category')}</label>
              <input value={form.category} onChange={set('category')} />
            </div>
            <div className="field">
              <label>{t(lang, 'salePrice')}</label>
              <input type="number" min="0" step="0.01" value={form.sale_price} onChange={set('sale_price')} />
            </div>
            <div className="field">
              <label>{t(lang, 'minStockLabel')}</label>
              <input type="number" min="0" step="1" value={form.min_stock} onChange={set('min_stock')} />
            </div>
          </div>
          {error && <div className="error-box">{error}</div>}
          {msg && <div className="success-box">{msg}</div>}
          <button className="btn-save" type="submit" disabled={busy}>
            {busy ? t(lang, 'loading') : t(lang, 'save')}
          </button>
        </form>
      </div>

      <div className="panel">
        <input
          className="search-input"
          placeholder={t(lang, 'search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 15 }}>
            {t(lang, 'noMedicines')}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'name')}</th>
                <th>{t(lang, 'genericName')}</th>
                <th>{t(lang, 'barcodeLabel')}</th>
                <th>{t(lang, 'unit')}</th>
                <th>{t(lang, 'salePrice')}</th>
                <th>{t(lang, 'stockQty')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.medicine_id}
                  className={barcodeExact && r.barcode === barcodeExact ? 'highlight' : ''}
                >
                  <td>{r.name}</td>
                  <td>{r.generic_name || '—'}</td>
                  <td>{r.barcode || '—'}</td>
                  <td>{r.unit}</td>
                  <td>{fmt(Number(r.sale_price))}</td>
                  <td>{fmt(r.total_quantity)}</td>
                  <td>
                    {r.low_stock && <span className="badge low">{t(lang, 'lowBadge')}</span>}
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

function SalesPage({ lang }: { lang: Lang }) {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [recent, setRecent] = useState<SaleRow[]>([]);
  const [query, setQuery] = useState('');
  const [bill, setBill] = useState<BillItem[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [retQtys, setRetQtys] = useState<Record<string, string>>({});
  const [retError, setRetError] = useState('');
  const [retMsg, setRetMsg] = useState('');
  const [retBusy, setRetBusy] = useState(false);

  const loadStock = async () => {
    const data = await api.get('/stock');
    setStock(data.stock as StockRow[]);
  };
  const loadRecent = async () => {
    const data = await api.get('/sales');
    setRecent((data.sales as SaleRow[]).slice(0, 8));
  };

  useEffect(() => {
    loadStock().catch((err) => setError(err instanceof Error ? err.message : 'Error'));
    loadRecent().catch(() => undefined);
    api
      .get('/customers')
      .then((data) => setCustomers(data.customers as Customer[]))
      .catch(() => undefined);
  }, []);

  const q = query.trim().toLowerCase();
  const results = q
    ? stock.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.generic_name || '').toLowerCase().includes(q) ||
          (r.barcode || '').toLowerCase().includes(q)
      )
    : [];

  const addToBill = (med: StockRow) => {
    setMsg('');
    setBill((b) => {
      const existing = b.find((i) => i.medicine_id === med.medicine_id);
      if (existing) {
        return b.map((i) =>
          i.medicine_id === med.medicine_id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...b,
        {
          medicine_id: med.medicine_id,
          name: med.name,
          unit_price: Number(med.sale_price),
          quantity: 1,
        },
      ];
    });
  };

  // A barcode scanner "types" the barcode and presses Enter — an exact
  // barcode match on Enter adds that medicine straight to the bill.
  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    const exact = stock.find((r) => r.barcode === code);
    if (exact) {
      addToBill(exact);
      setQuery('');
    } else if (results.length === 1) {
      addToBill(results[0]);
      setQuery('');
    }
  };

  const setQty = (medicineId: string, qty: number) => {
    setBill((b) =>
      b.map((i) =>
        i.medicine_id === medicineId
          ? { ...i, quantity: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1 }
          : i
      )
    );
  };

  const removeItem = (medicineId: string) =>
    setBill((b) => b.filter((i) => i.medicine_id !== medicineId));

  const subtotal = bill.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const discountNum = discount === '' ? 0 : Number(discount) || 0;
  const net = Math.max(0, subtotal - discountNum);

  const complete = async () => {
    setError('');
    setMsg('');
    if (bill.length === 0) {
      setError(t(lang, 'billEmpty'));
      return;
    }
    setBusy(true);
    try {
      const data = await api.post('/sales', {
        items: bill.map((i) => ({ medicine_id: i.medicine_id, quantity: i.quantity })),
        discount: discountNum,
        customer_id: customerId || undefined,
      });
      setMsg(
        `✅ ${t(lang, 'saleDone')}: ${data.sale.invoice_no} — ${fmt(Number(data.sale.net_total))} ${t(lang, 'currency')}`
      );
      setBill([]);
      setDiscount('');
      setCustomerId('');
      await Promise.all([loadStock(), loadRecent()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setBusy(false);
  };

  const openReturn = async (saleId: string) => {
    setError('');
    setRetError('');
    setRetMsg('');
    setRetQtys({});
    try {
      const data = await api.get(`/sales/${saleId}`);
      setDetail(data.sale as SaleDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const refundPreview = detail
    ? detail.items.reduce((sum, it) => {
        const rq = Number(retQtys[it.item_id]) || 0;
        return sum + rq * Number(it.unit_price);
      }, 0)
    : 0;

  const submitReturn = async () => {
    if (!detail) return;
    setRetError('');
    setRetMsg('');
    const items = detail.items
      .map((it) => ({ item_id: it.item_id, quantity: Number(retQtys[it.item_id]) || 0 }))
      .filter((x) => x.quantity > 0);
    if (items.length === 0) {
      setRetError(t(lang, 'nothingToReturn'));
      return;
    }
    setRetBusy(true);
    try {
      const data = await api.post(`/sales/${detail.id}/return`, { items });
      setRetMsg(
        `${t(lang, 'returnDone')} — ${fmt(Number(data.refund_total))} ${t(lang, 'currency')}`
      );
      setRetQtys({});
      const fresh = await api.get(`/sales/${detail.id}`);
      setDetail(fresh.sale as SaleDetail);
      await Promise.all([loadStock(), loadRecent()]);
    } catch (err) {
      setRetError(err instanceof Error ? err.message : 'Error');
    }
    setRetBusy(false);
  };

  return (
    <>
      <h2>{t(lang, 'sales')}</h2>
      <div className="pos-grid">
        <div className="panel" style={{ marginTop: 0 }}>
          <form onSubmit={onSearchSubmit}>
            <input
              className="search-input"
              placeholder={t(lang, 'searchMedicine')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </form>
          {q && results.length === 0 && (
            <p className="muted" style={{ fontSize: 15 }}>
              {t(lang, 'noResults')}
            </p>
          )}
          {results.map((r) => (
            <button key={r.medicine_id} className="result-row" onClick={() => addToBill(r)}>
              <span>{r.name}</span>
              <span className="r-stock">
                {t(lang, 'available')}: {fmt(r.total_quantity)}
              </span>
              <span className="r-price">
                {fmt(Number(r.sale_price))} {t(lang, 'currency')}
              </span>
            </button>
          ))}
        </div>

        <div className="panel" style={{ marginTop: 0 }}>
          <h3>🧾 {t(lang, 'bill')}</h3>
          {bill.length === 0 ? (
            <p className="muted" style={{ fontSize: 15 }}>
              {t(lang, 'billEmpty')}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t(lang, 'name')}</th>
                  <th>{t(lang, 'salePrice')}</th>
                  <th>{t(lang, 'qty')}</th>
                  <th>{t(lang, 'lineTotal')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bill.map((i) => (
                  <tr key={i.medicine_id}>
                    <td>{i.name}</td>
                    <td>{fmt(i.unit_price)}</td>
                    <td>
                      <input
                        className="qty-input"
                        type="number"
                        min="1"
                        step="1"
                        value={i.quantity}
                        onChange={(e) => setQty(i.medicine_id, Number(e.target.value))}
                      />
                    </td>
                    <td>{fmt(i.unit_price * i.quantity)}</td>
                    <td>
                      <button className="btn-remove" onClick={() => removeItem(i.medicine_id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 14 }}>
            <div className="field">
              <label>{t(lang, 'customer')}</label>
              <select
                className="field-select"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">{t(lang, 'walkIn')}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="total-row" style={{ marginTop: 10 }}>
            <span>{t(lang, 'subtotal')}</span>
            <span>{fmt(subtotal)}</span>
          </div>
          <div className="total-row">
            <span>{t(lang, 'discount')}</span>
            <input
              className="discount-input"
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="total-row grand">
            <span>{t(lang, 'netTotal')}</span>
            <span>
              {fmt(net)} {t(lang, 'currency')}
            </span>
          </div>

          {error && <div className="error-box">{error}</div>}
          {msg && <div className="success-box">{msg}</div>}
          <button
            className="btn-save"
            style={{ width: '100%' }}
            onClick={complete}
            disabled={busy || bill.length === 0}
          >
            {busy ? t(lang, 'loading') : t(lang, 'completeSale')}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>🧾 {t(lang, 'recentBills')}</h3>
        {recent.length === 0 ? (
          <p className="muted">—</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'invoice')}</th>
                <th>{t(lang, 'customer')}</th>
                <th>{t(lang, 'lineTotal')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.invoice_no}
                    <span className="muted">
                      {' '}
                      · {String(s.sale_date).slice(0, 10)} {String(s.sale_date).slice(11, 16)}
                    </span>
                  </td>
                  <td>{s.customer_name || t(lang, 'walkIn')}</td>
                  <td>{fmt(Number(s.net_total))}</td>
                  <td>
                    <button className="btn-secondary" onClick={() => openReturn(s.id)}>
                      ↩️ {t(lang, 'returnSale')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <div className="panel">
          <h3>
            ↩️ {t(lang, 'billDetails')} — {detail.invoice_no}
            <span className="muted" style={{ fontSize: 14 }}>
              {' '}
              · {detail.customer_name || t(lang, 'walkIn')} · {fmt(Number(detail.net_total))}{' '}
              {t(lang, 'currency')}
            </span>
          </h3>
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'name')}</th>
                <th>{t(lang, 'salePrice')}</th>
                <th>{t(lang, 'soldQty')}</th>
                <th>{t(lang, 'returnedQty')}</th>
                <th>{t(lang, 'returnQty')}</th>
                <th>{t(lang, 'lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => {
                const left = it.quantity - it.returned_quantity;
                const rq = Number(retQtys[it.item_id]) || 0;
                return (
                  <tr key={it.item_id}>
                    <td>
                      {it.medicine_name}
                      <span className="muted"> · {it.batch_no}</span>
                    </td>
                    <td>{fmt(Number(it.unit_price))}</td>
                    <td>{fmt(it.quantity)}</td>
                    <td>{fmt(it.returned_quantity)}</td>
                    <td>
                      <input
                        className="qty-input"
                        type="number"
                        min="0"
                        max={left}
                        step="1"
                        value={retQtys[it.item_id] ?? ''}
                        onChange={(e) =>
                          setRetQtys((m) => ({ ...m, [it.item_id]: e.target.value }))
                        }
                      />
                    </td>
                    <td>{fmt(rq * Number(it.unit_price))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="total-row grand">
            <span>{t(lang, 'refundTotal')}</span>
            <span>
              {fmt(refundPreview)} {t(lang, 'currency')}
            </span>
          </div>
          {retError && <div className="error-box">{retError}</div>}
          {retMsg && <div className="success-box">{retMsg}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-save" onClick={submitReturn} disabled={retBusy}>
              {retBusy ? t(lang, 'loading') : t(lang, 'doReturn')}
            </button>
            <button className="btn-secondary" onClick={() => setDetail(null)} disabled={retBusy}>
              {t(lang, 'closeBtn')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PurchasesPage({ lang }: { lang: Lang }) {
  const [meds, setMeds] = useState<MedOption[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [paid, setPaid] = useState('');
  const [rows, setRows] = useState<PurchaseItemDraft[]>([
    { medicine_id: '', batch_no: '', expiry_date: '', quantity: '1', purchase_price: '' },
  ]);
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [supMsg, setSupMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSuppliers = async () => {
    const data = await api.get('/suppliers');
    setSuppliers(data.suppliers as Supplier[]);
  };
  const loadPurchases = async () => {
    const data = await api.get('/purchases');
    setPurchases((data.purchases as PurchaseRow[]).slice(0, 8));
  };

  useEffect(() => {
    api
      .get('/medicines')
      .then((data) => setMeds(data.medicines as MedOption[]))
      .catch((err) => setError(err instanceof Error ? err.message : 'Error'));
    loadSuppliers().catch(() => undefined);
    loadPurchases().catch(() => undefined);
  }, []);

  const setRow = (idx: number, key: keyof PurchaseItemDraft, value: string) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));

  const addRow = () =>
    setRows((rs) => [
      ...rs,
      { medicine_id: '', batch_no: '', expiry_date: '', quantity: '1', purchase_price: '' },
    ]);

  const removeRow = (idx: number) => setRows((rs) => rs.filter((_, i) => i !== idx));

  const total = rows.reduce(
    (sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.purchase_price) || 0),
    0
  );

  const addSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSupMsg('');
    setError('');
    if (!supName.trim()) return;
    try {
      await api.post('/suppliers', { name: supName.trim(), phone: supPhone.trim() || undefined });
      setSupMsg(t(lang, 'supplierAdded'));
      setSupName('');
      setSupPhone('');
      await loadSuppliers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const data = await api.post('/purchases', {
        supplier_id: supplierId || undefined,
        invoice_no: invoiceNo.trim() || undefined,
        paid_amount: paid === '' ? undefined : Number(paid),
        items: rows
          .filter((r) => r.medicine_id)
          .map((r) => ({
          medicine_id: r.medicine_id,
          batch_no: r.batch_no.trim(),
          expiry_date: r.expiry_date,
          quantity: Number(r.quantity),
            purchase_price: r.purchase_price === '' ? 0 : Number(r.purchase_price),
          })),
      });
      setMsg(
        `✅ ${t(lang, 'purchaseDone')}: ${data.purchase.invoice_no || ''} — ${fmt(Number(data.purchase.total_amount))} ${t(lang, 'currency')}`
      );
      setRows([{ medicine_id: '', batch_no: '', expiry_date: '', quantity: '1', purchase_price: '' }]);
      setInvoiceNo('');
      setPaid('');
      await loadPurchases();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setBusy(false);
  };

  return (
    <>
      <h2>{t(lang, 'purchases')}</h2>

      <div className="panel" style={{ marginTop: 0 }}>
        <h3>🏭 {t(lang, 'addSupplier')}</h3>
        <form onSubmit={addSupplier}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'name')} *</label>
              <input value={supName} onChange={(e) => setSupName(e.target.value)} />
            </div>
            <div className="field">
              <label>{t(lang, 'phone')}</label>
              <input value={supPhone} onChange={(e) => setSupPhone(e.target.value)} />
            </div>
          </div>
          {supMsg && <div className="success-box">{supMsg}</div>}
          <button className="btn-secondary" type="submit">
            {t(lang, 'save')}
          </button>
        </form>
      </div>

      <div className="panel">
        <h3>📦 {t(lang, 'newPurchase')}</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'supplier')}</label>
              <select
                className="field-select"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t(lang, 'invoiceNo')}</label>
              <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </div>
            <div className="field">
              <label>{t(lang, 'paidAmount')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
              />
            </div>
          </div>

          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>{t(lang, 'name')}</th>
                <th>{t(lang, 'batch')}</th>
                <th>{t(lang, 'expiryDate')}</th>
                <th>{t(lang, 'qty')}</th>
                <th>{t(lang, 'purchasePrice')}</th>
                <th>{t(lang, 'lineTotal')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td style={{ minWidth: 170 }}>
                    <select
                      className="cell-select"
                      value={r.medicine_id}
                      onChange={(e) => setRow(idx, 'medicine_id', e.target.value)}
                    >
                      <option value="">{t(lang, 'selectMedicine')}</option>
                      {meds.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      value={r.batch_no}
                      onChange={(e) => setRow(idx, 'batch_no', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="date"
                      value={r.expiry_date}
                      onChange={(e) => setRow(idx, 'expiry_date', e.target.value)}
                    />
                  </td>
                  <td style={{ width: 90 }}>
                    <input
                      className="cell-input"
                      type="number"
                      min="1"
                      step="1"
                      value={r.quantity}
                      onChange={(e) => setRow(idx, 'quantity', e.target.value)}
                    />
                  </td>
                  <td style={{ width: 110 }}>
                    <input
                      className="cell-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.purchase_price}
                      onChange={(e) => setRow(idx, 'purchase_price', e.target.value)}
                    />
                  </td>
                  <td>{fmt((Number(r.quantity) || 0) * (Number(r.purchase_price) || 0))}</td>
                  <td>
                    <button type="button" className="btn-remove" onClick={() => removeRow(idx)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn-secondary" onClick={addRow}>
            ➕ {t(lang, 'addItem')}
          </button>

          <div className="total-row grand">
            <span>{t(lang, 'lineTotal')}</span>
            <span>
              {fmt(total)} {t(lang, 'currency')}
            </span>
          </div>

          {error && <div className="error-box">{error}</div>}
          {msg && <div className="success-box">{msg}</div>}
          <button className="btn-save" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? t(lang, 'loading') : t(lang, 'completePurchase')}
          </button>
        </form>
      </div>

      <div className="panel">
        <h3>📦 {t(lang, 'recentPurchases')}</h3>
        {purchases.length === 0 ? (
          <p className="muted">—</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'invoiceNo')}</th>
                <th>{t(lang, 'supplier')}</th>
                <th>{t(lang, 'dateLabel')}</th>
                <th>{t(lang, 'lineTotal')}</th>
                <th>{t(lang, 'paidAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td>{p.invoice_no || '—'}</td>
                  <td>{p.supplier_name || '—'}</td>
                  <td>{String(p.purchase_date).slice(0, 10)}</td>
                  <td>{fmt(Number(p.total_amount))}</td>
                  <td>{fmt(Number(p.paid_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type ReportTab = 'daily' | 'monthly' | 'yearly';

function ReportsPage({ lang }: { lang: Lang }) {
  const now = new Date();
  const [tab, setTab] = useState<ReportTab>('daily');
  const [date, setDate] = useState(todayStr());
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daySales, setDaySales] = useState<SaleRow[]>([]);
  const [days, setDays] = useState<DayRow[]>([]);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError('');
        if (tab === 'daily') {
          const data = await api.get(`/reports/daily?date=${date}`);
          if (!alive) return;
          setSummary(data.summary as Summary);
          setDaySales(data.sales as SaleRow[]);
        } else if (tab === 'monthly') {
          const data = await api.get(`/reports/monthly?year=${year}&month=${month}`);
          if (!alive) return;
          setSummary(data.summary as Summary);
          setDays(data.days as DayRow[]);
        } else {
          const data = await api.get(`/reports/yearly?year=${year}`);
          if (!alive) return;
          setSummary(data.summary as Summary);
          setMonths(data.months as MonthRow[]);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, date, year, month]);

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'daily', label: t(lang, 'daily') },
    { key: 'monthly', label: t(lang, 'monthly') },
    { key: 'yearly', label: t(lang, 'yearly') },
  ];

  return (
    <>
      <h2>{t(lang, 'reports')}</h2>
      <div className="tabs">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            className={tab === tb.key ? 'active' : ''}
            onClick={() => setTab(tb.key)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="report-controls">
        {tab === 'daily' && (
          <div className="field">
            <label>{t(lang, 'dateLabel')}</label>
            <input
              className="cell-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        )}
        {tab === 'monthly' && (
          <>
            <div className="field">
              <label>{t(lang, 'year')}</label>
              <input
                className="cell-input"
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>{t(lang, 'month')}</label>
              <select
                className="field-select"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {tab === 'yearly' && (
          <div className="field">
            <label>{t(lang, 'year')}</label>
            <input
              className="cell-input"
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}
      {!summary && !error && <p className="muted">{t(lang, 'loading')}</p>}
      {summary && (
        <div className="cards">
          <div className="card">
            <div className="card-label">{t(lang, 'revenue')}</div>
            <div className="card-value">{fmt(summary.revenue)}</div>
            <div className="card-sub">{t(lang, 'currency')}</div>
          </div>
          <div className="card profit">
            <div className="card-label">{t(lang, 'profit')}</div>
            <div className="card-value">{fmt(summary.profit)}</div>
            <div className="card-sub">
              {t(lang, 'cost')}: {fmt(summary.cost_total)}
            </div>
          </div>
          <div className="card">
            <div className="card-label">{t(lang, 'salesCount')}</div>
            <div className="card-value">{fmt(summary.sales_count)}</div>
            <div className="card-sub">
              {t(lang, 'itemsSold')}: {fmt(summary.items_sold)}
            </div>
          </div>
        </div>
      )}

      {tab === 'daily' && summary && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'invoice')}</th>
                <th>{t(lang, 'customer')}</th>
                <th>{t(lang, 'lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {daySales.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.invoice_no}
                    <span className="muted"> · {String(s.sale_date).slice(11, 16)}</span>
                  </td>
                  <td>{s.customer_name || t(lang, 'walkIn')}</td>
                  <td>{fmt(Number(s.net_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'monthly' && summary && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'dateLabel')}</th>
                <th>{t(lang, 'salesCount')}</th>
                <th>{t(lang, 'revenue')}</th>
                <th>{t(lang, 'cost')}</th>
                <th>{t(lang, 'profit')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td>{String(d.day).slice(0, 10)}</td>
                  <td>{fmt(d.sales_count)}</td>
                  <td>{fmt(d.revenue)}</td>
                  <td>{fmt(d.cost_total)}</td>
                  <td>{fmt(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'yearly' && summary && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'month')}</th>
                <th>{t(lang, 'salesCount')}</th>
                <th>{t(lang, 'revenue')}</th>
                <th>{t(lang, 'cost')}</th>
                <th>{t(lang, 'profit')}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <td>
                    {year}-{String(m.month).padStart(2, '0')}
                  </td>
                  <td>{fmt(m.sales_count)}</td>
                  <td>{fmt(m.revenue)}</td>
                  <td>{fmt(m.cost_total)}</td>
                  <td>{fmt(m.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CustomersPage({ lang }: { lang: Lang }) {
  const [rows, setRows] = useState<CustomerFull[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<{
    customer: CustomerFull;
    totals: { bills: number; total_spent: number };
    sales: CustomerHistorySale[];
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const load = async () => {
    const data = await api.get('/customers');
    setRows(data.customers as CustomerFull[]);
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Error'));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      (r.phone || '').toLowerCase().includes(q)
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!name.trim()) {
      setError(t(lang, 'nameRequired'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/customers', {
        name: name.trim(),
        phone: phone.trim() || undefined,
      });
      setMsg(t(lang, 'customerAdded'));
      setName('');
      setPhone('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setBusy(false);
  };

  const selectCustomer = async (c: CustomerFull) => {
    setError('');
    setDeletingId('');
    setEditingId('');
    setSelectedId(c.id);
    setHistoryLoading(true);
    try {
      const data = await api.get(`/customers/${c.id}/history`);
      setHistory({
        customer: data.customer as CustomerFull,
        totals: data.totals as { bills: number; total_spent: number },
        sales: data.sales as CustomerHistorySale[],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
      setHistory(null);
    }
    setHistoryLoading(false);
  };

  const startEdit = (c: CustomerFull) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditPhone(c.phone || '');
    setDeletingId('');
    setError('');
    setMsg('');
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!editName.trim()) {
      setError(t(lang, 'nameRequired'));
      return;
    }
    setBusy(true);
    try {
      await api.put(`/customers/${editingId}`, {
        name: editName.trim(),
        phone: editPhone.trim() || undefined,
      });
      setMsg(t(lang, 'customerUpdated'));
      setEditingId('');
      await load();
      if (selectedId === editingId) {
        const c = rows.find((r) => r.id === editingId);
        if (c) await selectCustomer({ ...c, name: editName.trim(), phone: editPhone.trim() || null });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setBusy(false);
  };

  const removeCustomer = async (id: string) => {
    setError('');
    setMsg('');
    setBusy(true);
    try {
      await api.del(`/customers/${id}`);
      setMsg(t(lang, 'customerDeleted'));
      setDeletingId('');
      if (selectedId === id) {
        setSelectedId('');
        setHistory(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setBusy(false);
  };

  return (
    <>
      <h2>{t(lang, 'customers')}</h2>

      <div className="panel" style={{ marginTop: 0 }}>
        <h3>➕ {t(lang, 'addCustomer')}</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'name')} *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>{t(lang, 'phone')}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          {error && <div className="error-box">{error}</div>}
          {msg && <div className="success-box">{msg}</div>}
          <button className="btn-save" type="submit" disabled={busy}>
            {busy ? t(lang, 'loading') : t(lang, 'save')}
          </button>
        </form>
      </div>

      <div className="panel">
        <input
          className="search-input"
          placeholder={t(lang, 'searchCustomer')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 15 }}>
            {t(lang, 'noCustomers')}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'name')}</th>
                <th>{t(lang, 'phone')}</th>
                <th>{t(lang, 'registeredOn')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={selectedId === r.id ? 'highlight' : ''}
                  onClick={() => selectCustomer(r)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{r.name}</td>
                  <td>{r.phone || '—'}</td>
                  <td>{String(r.created_at).slice(0, 10)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {editingId === r.id ? (
                      <form
                        onSubmit={saveEdit}
                        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                      >
                        <input
                          className="cell-input"
                          style={{ width: 130 }}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                        <input
                          className="cell-input"
                          style={{ width: 110 }}
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                        />
                        <button className="btn-save" type="submit" disabled={busy}>
                          {t(lang, 'save')}
                        </button>
                        <button
                          className="btn-secondary"
                          type="button"
                          onClick={() => setEditingId('')}
                        >
                          {t(lang, 'cancel')}
                        </button>
                      </form>
                    ) : deletingId === r.id ? (
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 13 }}>{t(lang, 'confirmDelete')}</span>
                        <button
                          className="btn-remove"
                          style={{ padding: '6px 12px' }}
                          onClick={() => removeCustomer(r.id)}
                          disabled={busy}
                        >
                          {t(lang, 'delete')}
                        </button>
                        <button className="btn-secondary" onClick={() => setDeletingId('')}>
                          {t(lang, 'cancel')}
                        </button>
                      </span>
                    ) : (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-secondary" onClick={() => startEdit(r)}>
                          {t(lang, 'edit')}
                        </button>
                        <button className="btn-remove" onClick={() => setDeletingId(r.id)}>
                          {t(lang, 'delete')}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>🧾 {t(lang, 'purchaseHistory')}</h3>
        {!history && !historyLoading && (
          <p className="muted" style={{ fontSize: 15 }}>
            {t(lang, 'selectCustomer')}
          </p>
        )}
        {historyLoading && <p className="muted">{t(lang, 'loading')}</p>}
        {history && (
          <>
            <div className="cards">
              <div className="card">
                <div className="card-label">{t(lang, 'customer')}</div>
                <div className="card-value" style={{ fontSize: 20 }}>
                  {history.customer.name}
                </div>
                <div className="card-sub">{history.customer.phone || '—'}</div>
              </div>
              <div className="card">
                <div className="card-label">{t(lang, 'billsCount')}</div>
                <div className="card-value">{fmt(history.totals.bills)}</div>
              </div>
              <div className="card profit">
                <div className="card-label">{t(lang, 'totalSpent')}</div>
                <div className="card-value">{fmt(history.totals.total_spent)}</div>
                <div className="card-sub">{t(lang, 'currency')}</div>
              </div>
            </div>
            {history.sales.length === 0 ? (
              <p className="muted" style={{ fontSize: 15 }}>
                {t(lang, 'noPurchases')}
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t(lang, 'invoice')}</th>
                    <th>{t(lang, 'dateLabel')}</th>
                    <th>{t(lang, 'qty')}</th>
                    <th>{t(lang, 'lineTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.sales.map((s) => (
                    <tr key={s.id}>
                      <td>{s.invoice_no}</td>
                      <td>
                        {String(s.sale_date).slice(0, 10)} {String(s.sale_date).slice(11, 16)}
                      </td>
                      <td>{fmt(Number(s.items))}</td>
                      <td>{fmt(Number(s.net_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </>
  );
}

function BackupPage({ lang, onLogout }: { lang: Lang; onLogout: () => void }) {
  const [dlBusy, setDlBusy] = useState(false);
  const [dlMsg, setDlMsg] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rsBusy, setRsBusy] = useState(false);
  const [rsMsg, setRsMsg] = useState('');
  const [error, setError] = useState('');

  const download = async () => {
    setError('');
    setDlMsg('');
    setDlBusy(true);
    try {
      const name = await api.download('/backup/download', 'pharmacy_db.sql');
      setDlMsg(`${t(lang, 'backupDone')} — ${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setDlBusy(false);
  };

  const startRestore = () => {
    setError('');
    setRsMsg('');
    if (!file) {
      setError(t(lang, 'noFile'));
      return;
    }
    setConfirming(true);
  };

  const restore = async () => {
    if (!file) return;
    setError('');
    setRsBusy(true);
    try {
      const text = await file.text();
      await api.postText('/backup/restore', text);
      setRsMsg(t(lang, 'restoreDone'));
      setConfirming(false);
      window.setTimeout(onLogout, 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
      setRsBusy(false);
    }
  };

  return (
    <>
      <h2>{t(lang, 'backup')}</h2>
      {error && <div className="error-box">{error}</div>}

      <div className="panel" style={{ marginTop: 0 }}>
        <h3>⬇️ {t(lang, 'downloadBackup')}</h3>
        <p className="muted" style={{ fontSize: 15 }}>
          {t(lang, 'backupDesc')}
        </p>
        {dlMsg && <div className="success-box">{dlMsg}</div>}
        <button className="btn-save" onClick={download} disabled={dlBusy}>
          {dlBusy ? t(lang, 'loading') : `⬇️ ${t(lang, 'downloadBackup')}`}
        </button>
      </div>

      <div className="panel">
        <h3>⬆️ {t(lang, 'restoreBackup')}</h3>
        <p className="muted" style={{ fontSize: 15 }}>
          {t(lang, 'restoreDesc')}
        </p>
        <div className="error-box">{t(lang, 'restoreWarning')}</div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>{t(lang, 'chooseFile')}</label>
          <input
            type="file"
            accept=".sql"
            onChange={(e) => {
              setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null);
              setConfirming(false);
              setError('');
            }}
          />
        </div>
        {file && (
          <p className="muted" style={{ fontSize: 14 }}>
            📄 {file.name} — {fmt(Math.max(1, Math.round(file.size / 1024)))} KB
          </p>
        )}
        {rsMsg && <div className="success-box">{rsMsg}</div>}
        {!confirming ? (
          <button className="btn-secondary" onClick={startRestore} disabled={rsBusy}>
            ⬆️ {t(lang, 'restoreBackup')}
          </button>
        ) : (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontWeight: 600 }}>{t(lang, 'areYouSure')}</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-remove" style={{ padding: '8px 18px' }} onClick={restore} disabled={rsBusy}>
                {rsBusy ? t(lang, 'loading') : t(lang, 'confirmRestore')}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setConfirming(false)}
                disabled={rsBusy}
              >
                {t(lang, 'cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

interface ManagedUser {
  id: string;
  full_name: string;
  username: string;
  role: string;
  language: string;
  is_active: number;
  created_at: string;
}

interface BranchInfo {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
}

function SettingsPage({
  lang,
  user,
  setLang,
}: {
  lang: Lang;
  user: User;
  setLang: (l: Lang) => void;
}) {
  const isAdmin = user.role === 'admin';
  const [langMsg, setLangMsg] = useState('');
  const [langError, setLangError] = useState('');

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [branch, setBranch] = useState<BranchInfo | null>(null);
  const [brMsg, setBrMsg] = useState('');
  const [brError, setBrError] = useState('');

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [nuName, setNuName] = useState('');
  const [nuUsername, setNuUsername] = useState('');
  const [nuPassword, setNuPassword] = useState('');
  const [nuRole, setNuRole] = useState('cashier');
  const [usMsg, setUsMsg] = useState('');
  const [usError, setUsError] = useState('');

  const roleLabel = (r: string) =>
    r === 'admin'
      ? t(lang, 'roleAdmin')
      : r === 'pharmacist'
        ? t(lang, 'rolePharmacist')
        : t(lang, 'roleCashier');

  const loadUsers = async () => {
    const data = await api.get('/settings/users');
    setUsers(data.users as ManagedUser[]);
  };

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get('/settings/branch')
      .then((data) => setBranch(data.branch as BranchInfo))
      .catch((err) => setBrError(err instanceof Error ? err.message : 'Error'));
    loadUsers().catch((err) => setUsError(err instanceof Error ? err.message : 'Error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const chooseLang = async (l: Lang) => {
    setLangError('');
    setLangMsg('');
    setLang(l);
    try {
      await api.put('/settings/language', { language: l });
      setLangMsg(t(l, 'languageSaved'));
    } catch (err) {
      setLangError(err instanceof Error ? err.message : 'Error');
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg('');
    setPwError('');
    if (newPw.length < 6) {
      setPwError(t(lang, 'passwordTooShort'));
      return;
    }
    if (newPw !== confirmPw) {
      setPwError(t(lang, 'passwordMismatch'));
      return;
    }
    setPwBusy(true);
    try {
      await api.post('/settings/password', {
        current_password: curPw,
        new_password: newPw,
      });
      setPwMsg(t(lang, 'passwordChanged'));
      setCurPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Error');
    }
    setPwBusy(false);
  };

  const saveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branch) return;
    setBrMsg('');
    setBrError('');
    try {
      await api.put('/settings/branch', {
        name: branch.name,
        address: branch.address || undefined,
        phone: branch.phone || undefined,
      });
      setBrMsg(t(lang, 'saved'));
    } catch (err) {
      setBrError(err instanceof Error ? err.message : 'Error');
    }
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsMsg('');
    setUsError('');
    try {
      await api.post('/settings/users', {
        full_name: nuName.trim(),
        username: nuUsername.trim(),
        password: nuPassword,
        role: nuRole,
      });
      setUsMsg(t(lang, 'userAdded'));
      setNuName('');
      setNuUsername('');
      setNuPassword('');
      setNuRole('cashier');
      await loadUsers();
    } catch (err) {
      setUsError(err instanceof Error ? err.message : 'Error');
    }
  };

  const toggleActive = async (u: ManagedUser) => {
    setUsMsg('');
    setUsError('');
    try {
      await api.patch(`/settings/users/${u.id}/active`, { is_active: !u.is_active });
      await loadUsers();
    } catch (err) {
      setUsError(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <>
      <h2>{t(lang, 'settings')}</h2>

      <div className="panel" style={{ marginTop: 0 }}>
        <h3>🌐 {t(lang, 'languageLabel')}</h3>
        <div className="lang-switch">
          {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
            <button key={l} className={l === lang ? 'active' : ''} onClick={() => chooseLang(l)}>
              {LANG_NAMES[l]}
            </button>
          ))}
        </div>
        {langError && <div className="error-box">{langError}</div>}
        {langMsg && <div className="success-box">{langMsg}</div>}
      </div>

      <div className="panel">
        <h3>🔑 {t(lang, 'changePassword')}</h3>
        <form onSubmit={changePassword}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'currentPassword')}</label>
              <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
            </div>
            <div className="field">
              <label>{t(lang, 'newPassword')}</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
            </div>
            <div className="field">
              <label>{t(lang, 'confirmPassword')}</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
              />
            </div>
          </div>
          {pwError && <div className="error-box">{pwError}</div>}
          {pwMsg && <div className="success-box">{pwMsg}</div>}
          <button className="btn-save" type="submit" disabled={pwBusy}>
            {pwBusy ? t(lang, 'loading') : t(lang, 'changePassword')}
          </button>
        </form>
      </div>

      {isAdmin && branch && (
        <div className="panel">
          <h3>🏥 {t(lang, 'pharmacyInfo')}</h3>
          <form onSubmit={saveBranch}>
            <div className="form-grid">
              <div className="field">
                <label>{t(lang, 'branchName')} *</label>
                <input
                  value={branch.name}
                  onChange={(e) => setBranch({ ...branch, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>{t(lang, 'phone')}</label>
                <input
                  value={branch.phone || ''}
                  onChange={(e) => setBranch({ ...branch, phone: e.target.value })}
                />
              </div>
              <div className="field">
                <label>{t(lang, 'address')}</label>
                <input
                  value={branch.address || ''}
                  onChange={(e) => setBranch({ ...branch, address: e.target.value })}
                />
              </div>
            </div>
            {brError && <div className="error-box">{brError}</div>}
            {brMsg && <div className="success-box">{brMsg}</div>}
            <button className="btn-save" type="submit">
              {t(lang, 'save')}
            </button>
          </form>
        </div>
      )}

      {isAdmin && (
        <div className="panel">
          <h3>👥 {t(lang, 'users')}</h3>
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'fullName')}</th>
                <th>{t(lang, 'username')}</th>
                <th>{t(lang, 'role')}</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.username}</td>
                  <td>{roleLabel(u.role)}</td>
                  <td>
                    <span className={`badge ${u.is_active ? 'warning' : 'expired'}`}>
                      {u.is_active ? t(lang, 'active') : t(lang, 'inactive')}
                    </span>
                  </td>
                  <td>
                    {u.id !== user.id && (
                      <button className="btn-secondary" onClick={() => toggleActive(u)}>
                        {u.is_active ? t(lang, 'deactivate') : t(lang, 'activate')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: 20 }}>➕ {t(lang, 'addUser')}</h3>
          <form onSubmit={addUser}>
            <div className="form-grid">
              <div className="field">
                <label>{t(lang, 'fullName')} *</label>
                <input value={nuName} onChange={(e) => setNuName(e.target.value)} required />
              </div>
              <div className="field">
                <label>{t(lang, 'username')} *</label>
                <input value={nuUsername} onChange={(e) => setNuUsername(e.target.value)} required />
              </div>
              <div className="field">
                <label>{t(lang, 'password')} *</label>
                <input
                  type="password"
                  value={nuPassword}
                  onChange={(e) => setNuPassword(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>{t(lang, 'role')}</label>
                <select
                  className="field-select"
                  value={nuRole}
                  onChange={(e) => setNuRole(e.target.value)}
                >
                  <option value="cashier">{t(lang, 'roleCashier')}</option>
                  <option value="pharmacist">{t(lang, 'rolePharmacist')}</option>
                  <option value="admin">{t(lang, 'roleAdmin')}</option>
                </select>
              </div>
            </div>
            {usError && <div className="error-box">{usError}</div>}
            {usMsg && <div className="success-box">{usMsg}</div>}
            <button className="btn-save" type="submit">
              {t(lang, 'addUser')}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
