import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  returns_total?: number;
  returned_items?: number;
}

interface Batch {
  batch_id: string;
  batch_no: string;
  expiry_date: string;
  quantity_on_hand: number;
  purchase_price: number | string;
  medicine_name: string;
  days_remaining: number;
  level: 'expired' | 'critical' | 'warning' | 'ok';
}

interface StockRow {
  medicine_id: string;
  name: string;
  generic_name: string | null;
  company: string | null;
  barcode: string | null;
  unit: string;
  category: string | null;
  sale_price: number | string;
  min_stock: number;
  warn_months: number;
  created_at: string;
  total_quantity: number;
  batch_count: number;
  low_stock: boolean;
  nearest_expiry?: string | null;
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

interface SalePayment {
  id: string;
  amount: number | string;
  created_at: string;
}

interface SaleDetail {
  id: string;
  invoice_no: string;
  sale_date: string;
  total_amount: number | string;
  discount: number | string;
  net_total: number | string;
  paid_amount: number | string | null;
  voided_at: string | null;
  customer_name: string | null;
  seller_name?: string | null;
  items: SaleItemDetail[];
  payments?: SalePayment[];
  paid_total?: number;
  due_amount?: number;
  refunded_total?: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  due_total?: number | string;
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
  refunded_total?: number | string;
  paid_total?: number | string;
  due_amount?: number | string;
  voided?: number;
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
  seller_name?: string | null;
  items_sold?: number;
  items_returned?: number;
  refunded_total?: number;
  paid_total?: number;
  due_amount?: number;
  voided?: number;
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

interface SupplierRow extends Supplier {
  address: string | null;
  purchases_total: number | string;
  paid_total: number | string;
  due_total: number | string;
}

interface SupplierPaymentRow {
  id: string;
  amount: number | string;
  created_at: string;
}

interface SupplierDetail extends SupplierRow {
  purchases: PurchaseRow[];
  payments: SupplierPaymentRow[];
}

interface PurchaseRow {
  id: string;
  supplier_id: string | null;
  invoice_no: string | null;
  purchase_date: string;
  total_amount: number | string;
  paid_amount: number | string;
  supplier_name: string | null;
  returned_total: number | string;
}

interface PurchaseDetailItem {
  id: string;
  medicine_id: string;
  medicine_name: string;
  batch_id: string;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  purchase_price: number | string;
  returned_quantity: number | string;
}

interface PurchaseDetail extends PurchaseRow {
  items: PurchaseDetailItem[];
}

interface PurchaseItemDraft {
  id?: string;
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

interface MedRow {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
  cost_total: number;
  profit: number;
}

interface StockTotals {
  cost_total: number;
  sale_value: number;
  expected_profit: number;
  cost_expiring: number;
  cost_expired: number;
}

interface StockMedRow {
  id: string;
  name: string;
  quantity: number;
  cost_total: number;
  sale_value: number;
  expected_profit: number;
}

interface StockData {
  totals: StockTotals;
  medicines: StockMedRow[];
}

interface PurchRow {
  id: string | null;
  name: string;
  bills: number;
  bought: number;
  returned: number;
  paid: number;
  net: number;
}

type Page = 'dashboard' | 'medicines' | 'expiry' | 'sales' | 'purchases' | 'suppliers' | 'reports' | 'customers' | 'backup' | 'settings';

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

// A mobile number, when given, is exactly 10 digits (empty = not given).
const validPhone = (p: string) => p.trim() === '' || /^\d{10}$/.test(p.trim());

function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="lang-switch">
      {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
        <button key={l} type="button" className={l === lang ? 'active' : ''} onClick={() => setLang(l)}>
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
  const [prefillBarcode, setPrefillBarcode] = useState('');
  // From the till: a scanned barcode the system does not know opens the
  // Medicines page with the add form already carrying that barcode.
  const goAddMedicine = (barcode: string) => {
    setPrefillBarcode(barcode);
    setPage('medicines');
  };

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

  // Sections each role may open. The server enforces the same rules on
  // every route, so hiding a menu item is never the only protection.
  const allowedPages: Page[] =
    user.role === 'cashier'
      ? ['dashboard', 'sales', 'customers', 'settings', 'backup']
      : user.role === 'pharmacist'
        ? ['dashboard', 'medicines', 'expiry', 'sales', 'purchases', 'suppliers', 'reports', 'customers', 'settings', 'backup']
        : ['dashboard', 'medicines', 'expiry', 'sales', 'purchases', 'suppliers', 'reports', 'customers', 'settings', 'backup'];
  // Menu order: daily work first, then stock, buying, people, analysis,
  // and the system sections (backup, settings) last.
  const allMenu: { key: Page; label: string; icon: string }[] = [
    { key: 'dashboard', label: t(lang, 'dashboard'), icon: '🏠' },
    { key: 'sales', label: t(lang, 'sales'), icon: '🧾' },
    { key: 'medicines', label: t(lang, 'medicines'), icon: '💊' },
    { key: 'expiry', label: t(lang, 'expiryDates'), icon: '📅' },
    { key: 'purchases', label: t(lang, 'purchases'), icon: '📦' },
    { key: 'suppliers', label: t(lang, 'suppliers'), icon: '🚚' },
    { key: 'customers', label: t(lang, 'customers'), icon: '👥' },
    { key: 'reports', label: t(lang, 'reports'), icon: '📊' },
    { key: 'backup', label: t(lang, 'backup'), icon: '💾' },
    { key: 'settings', label: t(lang, 'settings'), icon: '⚙️' },
  ];
  const menu = allMenu.filter((m) => allowedPages.includes(m.key));
  const visiblePage = allowedPages.includes(page) ? page : 'dashboard';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">💊 {t(lang, 'appName')}</div>
        {menu.map((m) => (
          <button
            key={m.key}
            className={`nav${visiblePage === m.key ? ' active' : ''}`}
            onClick={() => setPage(m.key)}
          >
            <span className="nav-icon">{m.icon}</span>
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
          🚪 {t(lang, 'logout')}
        </button>
      </aside>
      <main className="main">
        {visiblePage === 'dashboard' && <Dashboard lang={lang} userName={user.full_name} role={user.role} onNavigate={setPage} />}
        {visiblePage === 'medicines' && <Medicines lang={lang} prefillBarcode={prefillBarcode} onPrefillConsumed={() => setPrefillBarcode('')} />}
        {visiblePage === 'expiry' && <ExpiryPage lang={lang} />}
        {visiblePage === 'sales' && <SalesPage lang={lang} role={user.role} onAddMedicine={goAddMedicine} />}
        {visiblePage === 'purchases' && <PurchasesPage lang={lang} />}
        {visiblePage === 'suppliers' && <SuppliersPage lang={lang} />}
        {visiblePage === 'reports' && <ReportsPage lang={lang} role={user.role} />}
        {visiblePage === 'customers' && <CustomersPage lang={lang} role={user.role} />}
        {visiblePage === 'backup' && <BackupPage lang={lang} isAdmin={user.role === 'admin'} onLogout={logout} />}
        {visiblePage === 'settings' && <SettingsPage lang={lang} user={user} setLang={setLang} />}
        {page !== 'dashboard' && page !== 'medicines' && page !== 'expiry' && page !== 'sales' && page !== 'purchases' && page !== 'suppliers' && page !== 'reports' && page !== 'customers' && page !== 'backup' && page !== 'settings' && (
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
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  // Caps Lock changes the password silently — warn the moment it is on.
  const checkCaps = (e: React.KeyboardEvent) => {
    const on = e.getModifierState?.('CapsLock');
    if (typeof on === 'boolean') setCapsOn(on);
  };

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
      setShakeKey((k) => k + 1);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-split">
        <div className="login-brand">
          <div className="brand-orb orb-1" />
          <div className="brand-orb orb-2" />
          <div className="login-brand-logo">💊</div>
          <h1>{t(lang, 'appName')}</h1>
          <p className="login-tagline">{t(lang, 'loginTagline')}</p>
          <ul className="login-feats">
            <li>
              <span>💊</span> {t(lang, 'loginFeat1')}
            </li>
            <li>
              <span>🧾</span> {t(lang, 'loginFeat2')}
            </li>
            <li>
              <span>📊</span> {t(lang, 'loginFeat3')}
            </li>
          </ul>
        </div>
        <form className="login-card" onSubmit={submit}>
          <LangSwitch lang={lang} setLang={setLang} />
          <h2>{t(lang, 'loginWelcome')}</h2>
          <label htmlFor="username">{t(lang, 'username')}</label>
          <div className="field-icon">
            <span className="field-icon-mark">👤</span>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <label htmlFor="password">{t(lang, 'password')}</label>
          <div className="field-icon has-eye">
            <span className="field-icon-mark">🔒</span>
            <input
              id="password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={checkCaps}
              onKeyUp={checkCaps}
              onBlur={() => setCapsOn(false)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="pw-eye"
              onClick={() => setShowPw(!showPw)}
              title={t(lang, 'showPassword')}
              aria-label={t(lang, 'showPassword')}
            >
              {showPw ? '🙈' : '👁️'}
            </button>
          </div>
          {capsOn && <div className="caps-warn">⚠️ {t(lang, 'capsLock')}</div>}
          {error && (
            <div key={shakeKey} className="error-box shake">
              ⚠️ {error}
            </div>
          )}
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> {t(lang, 'loading')}
              </>
            ) : (
              t(lang, 'login')
            )}
          </button>
        </form>
      </div>
      <p className="login-foot">{t(lang, 'loginFooter')}</p>
    </div>
  );
}

// Full weekday names for the dashboard week chart (index 0 = Sunday,
// matching Date.getDay()). Friday (جمعه) stays in the list so any date
// can be named, but the work week itself never shows it.
const WEEKDAY_NAMES: Record<Lang, string[]> = {
  ps: ['یکشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنج شنبه', 'جمعه', 'شنبه'],
  fa: ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The current Afghan work week as YYYY-MM-DD days: Saturday through
// today, never past Thursday (Friday is the weekly holiday). On Friday
// this returns the six days that just ended.
function workWeekDays(): string[] {
  const start = new Date(`${weekStartStr()}T00:00:00`);
  const today = new Date(`${todayStr()}T00:00:00`);
  const last = new Date(start);
  last.setDate(last.getDate() + 5);
  const end = today < last ? today : last;
  const pad = (n: number) => String(n).padStart(2, '0');
  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return days;
}

function Dashboard({
  lang,
  userName,
  role,
  onNavigate,
}: {
  lang: Lang;
  userName: string;
  role: string;
  onNavigate: (p: Page) => void;
}) {
  // A cashier sees their own sales only — no profit, no stock value, no
  // chart, and no shortcuts into sections they cannot open.
  const isCashier = role === 'cashier';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [weekDays, setWeekDays] = useState<{ label: string; revenue: number; profit: number }[]>([]);
  const [stockTotals, setStockTotals] = useState<{ cost_total: number; sale_value: number } | null>(null);
  const [recentBills, setRecentBills] = useState<SaleRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [daily, expiring, stockRes] = await Promise.all([
          api.get('/reports/daily'),
          api.get('/stock/expiring'),
          api.get('/stock'),
        ]);
        if (!alive) return;
        setSummary(daily.summary as Summary);
        setBatches(expiring.batches as Batch[]);
        setStock(stockRes.stock as StockRow[]);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Error');
      }
      // The chart and the stock-value card are extras: if either call fails,
      // the rest of the dashboard still shows.
      try {
        const wDays = workWeekDays();
        const [range, sv, recent] = await Promise.all([
          api.get(`/reports/range?from=${wDays[0]}&to=${wDays[wDays.length - 1]}`).catch(() => null),
          api.get('/reports/stock-value').catch(() => null),
          api.get('/sales').catch(() => null),
        ]);
        if (!alive) return;
        if (range && Array.isArray(range.days)) {
          const byDay = new Map<string, { revenue: number; profit: number }>(
            range.days.map((d: { day: string; revenue: number; profit: number }) => [
              String(d.day),
              { revenue: Number(d.revenue), profit: Number(d.profit) },
            ])
          );
          const pts: { label: string; revenue: number; profit: number }[] = [];
          for (const ds of wDays) {
            const row = byDay.get(ds) || { revenue: 0, profit: 0 };
            pts.push({
              label: WEEKDAY_NAMES[lang][new Date(`${ds}T00:00:00`).getDay()],
              revenue: row.revenue,
              profit: row.profit,
            });
          }
          setWeekDays(pts);
        }
        if (sv && sv.totals) {
          setStockTotals({
            cost_total: Number(sv.totals.cost_total),
            sale_value: Number(sv.totals.sale_value),
          });
        }
        if (recent && Array.isArray(recent.sales)) {
          setRecentBills((recent.sales as SaleRow[]).slice(0, 5));
        }
      } catch {
        // Extras stay hidden; the core dashboard already rendered.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const lowStockRows = stock
    .filter((s) => s.low_stock)
    .sort((a, b) => Number(a.total_quantity) - Number(b.total_quantity));
  const lowCount = lowStockRows.length;
  const levelLabel = (level: Batch['level']) =>
    level === 'expired'
      ? t(lang, 'levelExpired')
      : level === 'critical'
        ? t(lang, 'levelCritical')
        : level === 'warning'
          ? t(lang, 'levelWarning')
          : t(lang, 'levelOk');
  const margin =
    summary && summary.revenue !== 0
      ? Math.round((summary.profit / summary.revenue) * 1000) / 10
      : 0;

  return (
    <>
      <div className="dash-head">
        <div>
          <h2>{t(lang, 'dashboard')}</h2>
          <div className="dash-sub">
            {t(lang, 'welcomeBack')}, {userName} 👋
          </div>
        </div>
        <span className="dash-date">📅 {todayStr()}</span>
      </div>
      {error && <div className="error-box">{error}</div>}
      {!summary && !error && <p className="muted">{t(lang, 'loading')}</p>}

      <div className="quick-actions">
        <span className="qa-label">{t(lang, 'quickActions')}</span>
        <button className="btn-primary" onClick={() => onNavigate('sales')}>
          🧾 {t(lang, 'newSale')}
        </button>
        {!isCashier && (
          <>
            <button className="btn-secondary" onClick={() => onNavigate('purchases')}>
              📦 {t(lang, 'newPurchase')}
            </button>
            <button className="btn-secondary" onClick={() => onNavigate('medicines')}>
              💊 {t(lang, 'addMedicine')}
            </button>
            <button className="btn-secondary" onClick={() => onNavigate('reports')}>
              📊 {t(lang, 'viewReports')}
            </button>
          </>
        )}
      </div>

      {summary && (
        <div className="cards dash-cards">
          <div className="card dash-card accent-green">
            <div className="card-top">
              <span className="card-icon">💰</span>
              <span className="card-label">{t(lang, 'todayRevenue')}</span>
            </div>
            <div className="card-value">{fmt(summary.revenue)}</div>
            <div className="card-sub">{t(lang, 'currency')}</div>
          </div>
          {!isCashier && (
            <div className="card dash-card accent-teal">
              <div className="card-top">
                <span className="card-icon">📈</span>
                <span className="card-label">{t(lang, 'todayProfit')}</span>
              </div>
              <div className="card-value profit-value">{fmt(summary.profit)}</div>
              <div className="card-sub">
                {t(lang, 'profitMargin')}: {margin}%
              </div>
            </div>
          )}
          <div className="card dash-card accent-blue">
            <div className="card-top">
              <span className="card-icon">🧾</span>
              <span className="card-label">{t(lang, 'todayBills')}</span>
            </div>
            <div className="card-value">{fmt(summary.sales_count)}</div>
            <div className="card-sub">
              {t(lang, 'itemsSold')}: {fmt(summary.items_sold)}
            </div>
          </div>
          {!isCashier && (
            <div className="card dash-card accent-purple">
              <div className="card-top">
                <span className="card-icon">💊</span>
                <span className="card-label">{t(lang, 'totalMedicines')}</span>
              </div>
              <div className="card-value">{fmt(stock.length)}</div>
              <div className={lowCount > 0 ? 'card-sub alert' : 'card-sub'}>
                {t(lang, 'lowStock')}: {fmt(lowCount)}
              </div>
            </div>
          )}
          {stockTotals && (
            <div className="card dash-card accent-amber">
              <div className="card-top">
                <span className="card-icon">🏷️</span>
                <span className="card-label">{t(lang, 'stockValue')}</span>
              </div>
              <div className="card-value">{fmt(stockTotals.sale_value)}</div>
              <div className="card-sub">
                {t(lang, 'cost')}: {fmt(stockTotals.cost_total)}
              </div>
            </div>
          )}
        </div>
      )}

      {!isCashier && weekDays.length > 0 && (
        <div className="panel">
          <h3>📊 {t(lang, 'thisWeek')}</h3>
          <BarChart points={weekDays} revLabel={t(lang, 'revenue')} profitLabel={t(lang, 'profit')} />
        </div>
      )}

      <div className="dash-grid">
        <div className="panel">
          <h3 className="panel-head">
            <span>
              ⚠️ {t(lang, 'expiryWarnings')} <span className="count-badge">{batches.length}</span>
            </span>
            {!isCashier && (
              <button className="link-btn" onClick={() => onNavigate('expiry')}>
                {t(lang, 'viewAll')}
              </button>
            )}
          </h3>
          {batches.length === 0 ? (
            <p className="empty-note">{t(lang, 'noWarnings')}</p>
          ) : (
            <div className="table-scroll rows-6-dash">
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
            </div>
          )}
        </div>

        <div className="panel">
          <h3 className="panel-head">
            <span>
              📉 {t(lang, 'lowStock')} <span className="count-badge warn">{lowCount}</span>
            </span>
            {!isCashier && (
              <button className="link-btn" onClick={() => onNavigate('medicines')}>
                {t(lang, 'viewAll')}
              </button>
            )}
          </h3>
          {lowStockRows.length === 0 ? (
            <p className="empty-note">{t(lang, 'noLowStock')}</p>
          ) : (
            <div className="table-scroll rows-6-dash">
              <table>
                <thead>
                  <tr>
                    <th>{t(lang, 'medicine')}</th>
                    <th>{t(lang, 'onHand')}</th>
                    <th>{t(lang, 'minStockLabel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockRows.map((s) => (
                    <tr key={s.medicine_id}>
                      <td>{s.name}</td>
                      <td className={Number(s.total_quantity) === 0 ? 'qty-zero' : ''}>
                        {fmt(Number(s.total_quantity))}
                      </td>
                      <td>{fmt(Number(s.min_stock))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {recentBills.length > 0 && (
        <div className="panel">
          <h3 className="panel-head">
            <span>🧾 {t(lang, 'recentBills')}</span>
            <button className="link-btn" onClick={() => onNavigate('sales')}>
              {t(lang, 'viewAll')}
            </button>
          </h3>
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'invoice')}</th>
                <th>{t(lang, 'customer')}</th>
                <th>{t(lang, 'seller')}</th>
                <th>{t(lang, 'itemsSold')}</th>
                <th>{t(lang, 'total')}</th>
              </tr>
            </thead>
            <tbody>
              {recentBills.map((s) => {
                const soldQty = Number(s.items_sold || 0);
                const retQty = Number(s.items_returned || 0);
                const refunded = Number(s.refunded_total || 0);
                const displayTotal = Math.max(0, Number(s.net_total) - refunded);
                const due = Number(s.due_amount || 0);
                const isVoided = Number(s.voided || 0) === 1;
                const fullyReturned = soldQty > 0 && retQty >= soldQty;
                const partiallyReturned = retQty > 0 && !fullyReturned;
                return (
                  <tr
                    key={s.id}
                    style={fullyReturned || isVoided ? { opacity: 0.65 } : undefined}
                  >
                    <td>
                      {s.invoice_no}
                      <span className="muted">
                        {' '}
                        · {String(s.sale_date).slice(0, 10)} {String(s.sale_date).slice(11, 16)}
                      </span>{' '}
                      {isVoided ? (
                        <span className="badge expired">🚫 {t(lang, 'voidedFull')}</span>
                      ) : fullyReturned ? (
                        <span className="badge returned">↩️ {t(lang, 'returnedFull')}</span>
                      ) : partiallyReturned ? (
                        <span className="badge warning">↩️ {t(lang, 'returnedPartial')}</span>
                      ) : null}
                    </td>
                    <td>{s.customer_name || t(lang, 'walkIn')}</td>
                    <td>{s.seller_name || '—'}</td>
                    <td>{fmt(soldQty - retQty)}</td>
                    <td>
                      {fmt(displayTotal)}
                      {due > 0 && (
                        <>
                          {' '}
                          <span className="badge warning">
                            {t(lang, 'credit')}: {fmt(due)}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// All expiry dates, always visible — unlike the dashboard warnings, which
// only show a batch once its own warning window is reached. Every batch
// with stock is listed, soonest-expiring first, with search and a filter.
interface ExpiryBatch {
  batch_id: string;
  batch_no: string;
  expiry_date: string;
  quantity_on_hand: number;
  purchase_price: number | string;
  medicine_name: string;
  company: string | null;
  barcode: string | null;
  warn_months: number;
  days_remaining: number;
  level: 'expired' | 'critical' | 'warning' | 'ok';
}

type ExpiryFilter = 'all' | 'expired' | 'warning' | 'ok';

interface WriteOffRow {
  created_at: string;
  quantity_change: number;
  reason: string | null;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  written_by: string | null;
}

function ExpiryPage({ lang }: { lang: Lang }) {
  const [rows, setRows] = useState<ExpiryBatch[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ExpiryFilter>('all');
  const [error, setError] = useState('');
  const [writeOffs, setWriteOffs] = useState<WriteOffRow[]>([]);
  const [woBatch, setWoBatch] = useState<ExpiryBatch | null>(null);
  const [woQty, setWoQty] = useState('');
  const [woReason, setWoReason] = useState('');
  const [woBusy, setWoBusy] = useState(false);
  const [woMsg, setWoMsg] = useState('');
  const [woDone, setWoDone] = useState('');
  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [branch, setBranch] = useState<BranchInfo | null>(null);

  const loadRows = () => {
    api
      .get('/stock/all-batches')
      .then((data) => setRows(data.batches as ExpiryBatch[]))
      .catch((err) => setError(err instanceof Error ? err.message : 'Error'));
  };
  const loadWriteOffs = () => {
    api
      .get('/stock/write-offs')
      .then((data) => setWriteOffs(data.writeOffs as WriteOffRow[]))
      .catch(() => setWriteOffs([]));
  };

  useEffect(() => {
    loadRows();
    loadWriteOffs();
  }, []);

  useEffect(() => {
    api
      .get('/settings/branch')
      .then((data) => setBranch(data.branch as BranchInfo))
      .catch(() => undefined);
  }, []);

  // Print the expiry sheet as soon as it has rendered (same pattern as
  // the report print): the browser dialog offers both the printer and
  // "Save as PDF".
  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 80);
    return () => clearTimeout(timer);
  }, [printing]);

  const doExport = async () => {
    setError('');
    setExporting(true);
    try {
      await api.download(
        `/stock/expiry-export?filter=${filter}&q=${encodeURIComponent(query.trim())}`,
        `pharmacy-expiry-list-${todayStr()}.xlsx`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setExporting(false);
  };

  const submitWriteOff = async () => {
    if (!woBatch) return;
    const qty = Number(woQty);
    if (!Number.isInteger(qty) || qty <= 0 || qty > woBatch.quantity_on_hand) {
      setWoMsg(t(lang, 'writeOffTooMuch'));
      return;
    }
    setWoBusy(true);
    setWoMsg('');
    try {
      await api.post(`/stock/batches/${woBatch.batch_id}/write-off`, {
        quantity: qty,
        reason: woReason.trim() || undefined,
      });
      setWoDone(t(lang, 'writeOffDone'));
      setWoBatch(null);
      setWoQty('');
      setWoReason('');
      loadRows();
      loadWriteOffs();
    } catch (err) {
      setWoMsg(err instanceof Error ? err.message : 'Error');
    } finally {
      setWoBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (filter === 'expired' && r.level !== 'expired') return false;
    if (filter === 'warning' && r.level !== 'warning' && r.level !== 'critical') return false;
    if (filter === 'ok' && r.level !== 'ok') return false;
    return (
      !q ||
      r.medicine_name.toLowerCase().includes(q) ||
      (r.company || '').toLowerCase().includes(q) ||
      r.batch_no.toLowerCase().includes(q)
    );
  });

  const expiredCount = rows.filter((r) => r.level === 'expired').length;
  const warnCount = rows.filter((r) => r.level === 'warning' || r.level === 'critical').length;
  const expiredRows = rows.filter((r) => r.level === 'expired');
  const warnRows = rows.filter((r) => r.level === 'warning' || r.level === 'critical');
  const okRows = rows.filter((r) => r.level === 'ok');
  const sumQty = (list: ExpiryBatch[]) => list.reduce((s, r) => s + Number(r.quantity_on_hand), 0);
  const batchValue = (r: ExpiryBatch) => Number(r.quantity_on_hand) * Number(r.purchase_price || 0);
  const expiredValue = expiredRows.reduce((s, r) => s + batchValue(r), 0);
  const levelLabel = (level: ExpiryBatch['level']) =>
    level === 'expired'
      ? t(lang, 'levelExpired')
      : level === 'critical'
        ? t(lang, 'levelCritical')
        : level === 'warning'
          ? t(lang, 'levelWarning')
          : t(lang, 'levelOk');

  const filters: { key: ExpiryFilter; label: string }[] = [
    { key: 'all', label: `${t(lang, 'filterAll')} (${rows.length})` },
    { key: 'expired', label: `${t(lang, 'filterExpired')} (${expiredCount})` },
    { key: 'warning', label: `${t(lang, 'filterWarning')} (${warnCount})` },
    { key: 'ok', label: `${t(lang, 'filterOk')} (${rows.length - expiredCount - warnCount})` },
  ];

  return (
    <>
      <div className="dash-head">
        <h2>
          {t(lang, 'expiryDates')} <span className="count-badge neutral">{rows.length}</span>
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            onClick={doExport}
            disabled={exporting || filtered.length === 0}
          >
            📊 {exporting ? t(lang, 'loading') : t(lang, 'exportExcel')}
          </button>
          <button className="btn" onClick={() => setPrinting(true)} disabled={filtered.length === 0}>
            🖨️ {t(lang, 'printPdf')}
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
        {t(lang, 'expiryDatesDesc')}
      </p>
      <div className="cards dash-cards">
        <div className="card dash-card accent-red">
          <div className="card-top">
            <span className="card-icon">⛔</span>
            <span className="card-label">{t(lang, 'filterExpired')}</span>
          </div>
          <div className="card-value">{fmt(expiredCount)}</div>
          <div className="card-sub">
            {fmt(sumQty(expiredRows))} {t(lang, 'units')} · {fmt(expiredValue)} {t(lang, 'currency')}
          </div>
        </div>
        <div className="card dash-card accent-amber">
          <div className="card-top">
            <span className="card-icon">⚠️</span>
            <span className="card-label">{t(lang, 'filterWarning')}</span>
          </div>
          <div className="card-value">{fmt(warnCount)}</div>
          <div className="card-sub">
            {fmt(sumQty(warnRows))} {t(lang, 'units')}
          </div>
        </div>
        <div className="card dash-card accent-green">
          <div className="card-top">
            <span className="card-icon">✅</span>
            <span className="card-label">{t(lang, 'filterOk')}</span>
          </div>
          <div className="card-value">{fmt(okRows.length)}</div>
          <div className="card-sub">
            {fmt(sumQty(okRows))} {t(lang, 'units')}
          </div>
        </div>
        <div className="card dash-card accent-blue">
          <div className="card-top">
            <span className="card-icon">💸</span>
            <span className="card-label">{t(lang, 'expiredValue')}</span>
          </div>
          <div className="card-value">{fmt(expiredValue)}</div>
          <div className="card-sub">{t(lang, 'currency')}</div>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="tabs">
        {filters.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? 'active' : ''}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <input
        className="search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t(lang, 'searchExpiry')}
      />
      {woBatch && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>🗑️ {t(lang, 'writeOffTitle')}</h3>
          <p className="muted" style={{ fontSize: 14 }}>
            {woBatch.medicine_name} — {t(lang, 'batch')}: {woBatch.batch_no} ·{' '}
            {t(lang, 'expiryDate')}: {String(woBatch.expiry_date).slice(0, 10)} ·{' '}
            {t(lang, 'qty')}: {woBatch.quantity_on_hand}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label>
              {t(lang, 'writeOffQty')}{' '}
              <input
                type="number"
                min={1}
                max={woBatch.quantity_on_hand}
                value={woQty}
                onChange={(e) => setWoQty(e.target.value)}
                style={{ width: 90 }}
              />
            </label>
            <label>
              {t(lang, 'writeOffReason')}{' '}
              <input
                type="text"
                value={woReason}
                onChange={(e) => setWoReason(e.target.value)}
                placeholder={t(lang, 'writeOffReasonPh')}
                style={{ width: 220 }}
              />
            </label>
            <button className="btn-danger" onClick={submitWriteOff} disabled={woBusy}>
              {t(lang, 'writeOffConfirm')}
            </button>
            <button className="btn-secondary" onClick={() => { setWoBatch(null); setWoMsg(''); }} disabled={woBusy}>
              {t(lang, 'writeOffCancel')}
            </button>
          </div>
          {Number(woQty) > 0 && (
            <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
              {t(lang, 'total')}: {fmt(Number(woQty) * Number(woBatch.purchase_price || 0))}{' '}
              {t(lang, 'currency')}
            </p>
          )}
          {woMsg && <div className="error-box" style={{ marginTop: 8 }}>{woMsg}</div>}
        </div>
      )}
      {woDone && <div className="success-box">{woDone}</div>}
      <div className="panel">
        {filtered.length === 0 ? (
          <p className="empty-note">{rows.length === 0 ? t(lang, 'noBatches') : t(lang, 'noResults')}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t(lang, 'medicine')}</th>
                  <th>{t(lang, 'company')}</th>
                  <th>{t(lang, 'batch')}</th>
                  <th>{t(lang, 'expiryDate')}</th>
                  <th>{t(lang, 'daysLeft')}</th>
                  <th>{t(lang, 'qty')}</th>
                  <th>{t(lang, 'batchValue')}</th>
                  <th>{t(lang, 'warnMonthsCol')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr
                    key={b.batch_id}
                    className={
                      b.level === 'expired'
                        ? 'row-expired'
                        : b.level === 'warning' || b.level === 'critical'
                          ? 'row-warning'
                          : ''
                    }
                  >
                    <td>{b.medicine_name}</td>
                    <td>{b.company || '—'}</td>
                    <td>{b.batch_no}</td>
                    <td>{String(b.expiry_date).slice(0, 10)}</td>
                    <td
                      className={
                        b.days_remaining < 0
                          ? 'days-neg'
                          : b.level === 'warning' || b.level === 'critical'
                            ? 'qty-low'
                            : ''
                      }
                    >
                      {b.days_remaining}
                    </td>
                    <td>{b.quantity_on_hand}</td>
                    <td>{fmt(batchValue(b))}</td>
                    <td>{b.warn_months ?? 3}</td>
                    <td>
                      <span className={`badge ${b.level}`}>{levelLabel(b.level)}</span>{' '}
                      {b.level === 'expired' && (
                        <button
                          className="btn small"
                          onClick={() => {
                            setWoBatch(b);
                            setWoQty(String(b.quantity_on_hand));
                            setWoReason('');
                            setWoMsg('');
                            setWoDone('');
                          }}
                        >
                          {t(lang, 'writeOff')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <h3 style={{ marginTop: 24 }}>🗑️ {t(lang, 'writeOffHistory')}</h3>
      <div className="panel">
        {writeOffs.length === 0 ? (
          <p className="empty-note">{t(lang, 'writeOffEmpty')}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t(lang, 'writeOffDate')}</th>
                  <th>{t(lang, 'medicine')}</th>
                  <th>{t(lang, 'batch')}</th>
                  <th>{t(lang, 'expiryDate')}</th>
                  <th>{t(lang, 'qty')}</th>
                  <th>{t(lang, 'writeOffReason')}</th>
                  <th>{t(lang, 'writtenBy')}</th>
                </tr>
              </thead>
              <tbody>
                {writeOffs.map((w, i) => (
                  <tr key={i}>
                    <td>{String(w.created_at).slice(0, 10)}</td>
                    <td>{w.medicine_name}</td>
                    <td>{w.batch_no}</td>
                    <td>{String(w.expiry_date).slice(0, 10)}</td>
                    <td>{Math.abs(Number(w.quantity_change))}</td>
                    <td>{w.reason || '—'}</td>
                    <td>{w.written_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {printing &&
        createPortal(
          <div id="report-print" dir={lang === 'en' ? 'ltr' : 'rtl'}>
            <div className="print-head">
              <div className="print-brand">{branch?.name || 'Pharmacy'}</div>
              {branch?.address && <div>{branch.address}</div>}
              {branch?.phone && <div>{branch.phone}</div>}
              <div className="print-title">
                {t(lang, 'expiryDates')} —{' '}
                {filter === 'all'
                  ? t(lang, 'filterAll')
                  : filter === 'expired'
                    ? t(lang, 'filterExpired')
                    : filter === 'warning'
                      ? t(lang, 'filterWarning')
                      : t(lang, 'filterOk')}{' '}
                — {todayStr()}
              </div>
            </div>
            <table className="print-nums">
              <thead>
                <tr>
                  <th>{t(lang, 'medicine')}</th>
                  <th>{t(lang, 'batch')}</th>
                  <th>{t(lang, 'expiryDate')}</th>
                  <th>{t(lang, 'daysLeft')}</th>
                  <th>{t(lang, 'qty')}</th>
                  <th>{t(lang, 'batchValue')}</th>
                  <th>{t(lang, 'expiryStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.batch_id}>
                    <td>{b.medicine_name}</td>
                    <td>{b.batch_no}</td>
                    <td>{String(b.expiry_date).slice(0, 10)}</td>
                    <td>{b.days_remaining}</td>
                    <td>{b.quantity_on_hand}</td>
                    <td>{fmt(batchValue(b))}</td>
                    <td>{levelLabel(b.level)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{t(lang, 'total')}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td>{fmt(sumQty(filtered))}</td>
                  <td>{fmt(filtered.reduce((s, r) => s + batchValue(r), 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            <div className="print-footer">
              {t(lang, 'generatedOn')}: {new Date().toLocaleString()}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function Medicines({ lang, prefillBarcode, onPrefillConsumed }: { lang: Lang; prefillBarcode: string; onPrefillConsumed: () => void }) {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const blankForm = {
    name: '',
    generic_name: '',
    company: '',
    barcode: '',
    unit: 'tablet',
    category: '',
    sale_price: '',
    min_stock: '10',
    warn_months: '3',
    init_qty: '',
    init_price: '',
    init_expiry: '',
    init_batch: '',
    init_supplier: '',
  };
  const [form, setForm] = useState(blankForm);

  // Arriving from the till with an unknown scanned barcode: open the
  // add form with that barcode already filled in, then consume the
  // prefill so a later visit to this page starts normally.
  const prefillRef = useRef(prefillBarcode);
  useEffect(() => {
    const code = prefillRef.current;
    if (code) {
      setEditingId(null);
      setForm({ ...blankForm, barcode: code });
      setFormOpen(true);
      onPrefillConsumed();
      window.scrollTo({ top: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (r: StockRow) => {
    setEditingId(r.medicine_id);
    setFormOpen(true);
    setError('');
    setMsg('');
    setForm({
      ...blankForm,
      name: r.name,
      generic_name: r.generic_name || '',
      company: r.company || '',
      barcode: r.barcode || '',
      unit: r.unit || 'tablet',
      category: r.category || '',
      sale_price: String(r.sale_price ?? ''),
      min_stock: String(r.min_stock ?? 10),
      warn_months: String(r.warn_months ?? 3),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormOpen(false);
    setError('');
    setMsg('');
    setForm(blankForm);
  };

  const doDelete = async (id: string) => {
    setError('');
    setMsg('');
    try {
      await api.del(`/medicines/${id}`);
      if (editingId === id) cancelEdit();
      setConfirmDeleteId(null);
      setMsg(t(lang, 'medicineDeleted'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const load = async () => {
    const data = await api.get('/stock');
    setRows(data.stock as StockRow[]);
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Error'));
    api
      .get('/suppliers')
      .then((data) => setSuppliers(data.suppliers as Supplier[]))
      .catch(() => undefined);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!q ||
        r.name.toLowerCase().includes(q) ||
        (r.generic_name || '').toLowerCase().includes(q) ||
        (r.barcode || '').toLowerCase().includes(q)) &&
      (stockFilter === 'all'
        ? true
        : stockFilter === 'low'
          ? r.low_stock
          : Number(r.total_quantity) === 0)
  );
  const barcodeExact = query.trim();
  const lowCount = rows.filter((r) => r.low_stock).length;
  const outCount = rows.filter((r) => Number(r.total_quantity) === 0).length;
  const unitOptions = [...new Set(rows.map((r) => r.unit).filter(Boolean))].sort();
  const categoryOptions = [...new Set(rows.map((r) => r.category || '').filter(Boolean))].sort();

  // Soft warning when the typed name already exists under another record —
  // the barcode check still guards true duplicates at save time.
  const checkName = () => {
    const n = form.name.trim().toLowerCase();
    if (!n) return;
    const dup = rows.find((r) => r.name.toLowerCase() === n && r.medicine_id !== editingId);
    if (dup) {
      setMsg('');
      setError(`${t(lang, 'nameExists')}: ${dup.name}`);
    }
  };

  const expiryCell = (r: StockRow) => {
    if (!r.nearest_expiry) return '—';
    const d = String(r.nearest_expiry).slice(0, 10);
    const days = Math.ceil(
      (new Date(`${d}T00:00:00`).getTime() - new Date(`${todayStr()}T00:00:00`).getTime()) / 86400000
    );
    if (days < 0) {
      return (
        <>
          <div>{d}</div>
          <span className="badge expired">{t(lang, 'levelExpired')}</span>
        </>
      );
    }
    const warnDays = Number(r.warn_months || 3) * 30;
    return (
      <>
        <div>{d}</div>
        <div className={days <= warnDays ? 'qty-low' : 'muted'} style={{ fontSize: 12.5 }}>
          {days} {t(lang, 'daysLeft')}
        </div>
      </>
    );
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // Scanner support: as soon as a barcode is scanned (or typed) into the
  // barcode box, look it up — warn if this medicine already exists so it is
  // never added twice, or confirm it is new and the rest can be filled in.
  const checkBarcode = async (code: string) => {
    const c = code.trim();
    if (!c) return;
    try {
      const data: any = await api.get(`/medicines?barcode=${encodeURIComponent(c)}`);
      if (data.medicines && data.medicines.length > 0) {
        if (data.medicines[0].id === editingId) return; // the medicine being edited
        setMsg('');
        setError(`${t(lang, 'barcodeExists')}: ${data.medicines[0].name}`);
      } else {
        // New to this pharmacy — try the free online product databases as a
        // helper. They cover some international products and none of others,
        // so a hit only PREFILLS name/company for the pharmacist to check;
        // a miss (or no internet) leaves manual entry exactly as before.
        const product: any = await lookupOnline(c);
        if (product && (product.product_name || product.brands)) {
          setForm((f: any) => ({
            ...f,
            name: f.name || product.product_name || '',
            company: f.company || String(product.brands || '').split(',')[0].trim(),
          }));
          setError('');
          setMsg(t(lang, 'barcodeOnlineFound'));
        } else {
          setError('');
          setMsg(t(lang, 'barcodeNew'));
        }
      }
    } catch {
      /* Lookup failed — the save-time checks still apply. */
    }
  };

  const lookupOnline = async (code: string): Promise<any> => {
    const sources = [
      `https://world.openproductsfacts.org/api/v0/product/${encodeURIComponent(code)}.json`,
      `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`,
    ];
    for (const url of sources) {
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.status === 1 && data.product) return data.product;
      } catch {
        /* Offline or blocked — try the next source. */
      }
    }
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    // All main fields are required — the medicine is only saved once every
    // one of them is filled in; the error names the empty ones.
    const missing: string[] = [];
    if (!form.name.trim()) missing.push(t(lang, 'name'));
    if (!form.generic_name.trim()) missing.push(t(lang, 'genericName'));
    if (!form.company.trim()) missing.push(t(lang, 'company'));
    if (!form.barcode.trim()) missing.push(t(lang, 'barcodeLabel'));
    if (!form.unit.trim()) missing.push(t(lang, 'unit'));
    if (!form.category.trim()) missing.push(t(lang, 'category'));
    if (form.sale_price.trim() === '') missing.push(t(lang, 'salePrice'));
    if (form.min_stock.trim() === '') missing.push(t(lang, 'minStockLabel'));
    if (missing.length > 0) {
      setError(`${t(lang, 'fillRequired')}: ${missing.join(', ')}`);
      return;
    }
    const initQty = Number(form.init_qty) || 0;
    if (initQty > 0 && !form.init_expiry) {
      setError(t(lang, 'expiryNeeded'));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        generic_name: form.generic_name.trim() || undefined,
        company: form.company.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        unit: form.unit.trim() || undefined,
        category: form.category.trim() || undefined,
        sale_price: form.sale_price === '' ? undefined : Number(form.sale_price),
        min_stock: form.min_stock === '' ? undefined : Number(form.min_stock),
        warn_months: form.warn_months.trim() === '' ? undefined : Number(form.warn_months),
      };
      if (editingId) {
        // Correcting an existing medicine — details only, stock untouched.
        await api.put(`/medicines/${editingId}`, payload);
        setMsg(t(lang, 'medicineUpdated'));
        setEditingId(null);
        setFormOpen(false);
      } else {
        await api.post('/medicines', {
          ...payload,
          initial_stock:
            initQty > 0
              ? {
                  quantity: initQty,
                  purchase_price: form.init_price === '' ? 0 : Number(form.init_price),
                  expiry_date: form.init_expiry,
                  batch_no: form.init_batch.trim() || undefined,
                  supplier_id: form.init_supplier || undefined,
                }
              : undefined,
        });
        setMsg(t(lang, 'added'));
      }
      setForm(blankForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setBusy(false);
  };

  return (
    <>
      <div className="dash-head">
        <h2>
          {t(lang, 'medicines')} <span className="count-badge neutral">{rows.length}</span>
        </h2>
        {!formOpen && (
          <button
            className="btn-primary"
            style={{ width: 'auto', marginTop: 0 }}
            onClick={() => {
              cancelEdit();
              setFormOpen(true);
            }}
          >
            ➕ {t(lang, 'addMedicine')}
          </button>
        )}
      </div>

      {formOpen && (
      <div className="panel">
        <h3>{editingId ? `✏️ ${t(lang, 'editMedicine')}` : `➕ ${t(lang, 'addMedicine')}`}</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'name')} *</label>
              <input value={form.name} onChange={set('name')} onBlur={checkName} />
            </div>
            <div className="field">
              <label>{t(lang, 'genericName')} *</label>
              <input id="med-generic" value={form.generic_name} onChange={set('generic_name')} />
            </div>
            <div className="field">
              <label>{t(lang, 'company')} *</label>
              <input value={form.company} onChange={set('company')} />
            </div>
            <div className="field">
              <label>{t(lang, 'barcodeLabel')} *</label>
              <input
                value={form.barcode}
                onChange={set('barcode')}
                onBlur={() => checkBarcode(form.barcode)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // A scanner "types" the code, then presses Enter — check
                    // the code and move to the next box instead of submitting.
                    e.preventDefault();
                    checkBarcode(form.barcode);
                    document.getElementById('med-generic')?.focus();
                  }
                }}
              />
            </div>
            <div className="field">
              <label>{t(lang, 'unit')} *</label>
              <input value={form.unit} onChange={set('unit')} list="med-units" />
              <datalist id="med-units">
                {unitOptions.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>{t(lang, 'category')} *</label>
              <input value={form.category} onChange={set('category')} list="med-categories" />
              <datalist id="med-categories">
                {categoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>{t(lang, 'salePrice')} *</label>
              <input type="number" min="0" step="0.01" value={form.sale_price} onChange={set('sale_price')} />
            </div>
            <div className="field">
              <label>{t(lang, 'minStockLabel')} *</label>
              <input type="number" min="0" step="1" value={form.min_stock} onChange={set('min_stock')} />
            </div>
            <div className="field">
              <label>{t(lang, 'warnMonths')}</label>
              <input type="number" min="0" max="24" step="1" value={form.warn_months} onChange={set('warn_months')} />
            </div>
          </div>
          {!editingId && (
            <>
              <h4 style={{ margin: '16px 0 8px' }}>📦 {t(lang, 'initialStock')}</h4>
              <div className="form-grid">
                <div className="field">
                  <label>{t(lang, 'qty')}</label>
                  <input type="number" min="0" step="1" value={form.init_qty} onChange={set('init_qty')} />
                </div>
                <div className="field">
                  <label>{t(lang, 'purchasePrice')}</label>
                  <input type="number" min="0" step="0.01" value={form.init_price} onChange={set('init_price')} />
                </div>
                <div className="field">
                  <label>{t(lang, 'expiryDate')}</label>
                  <input type="date" value={form.init_expiry} onChange={set('init_expiry')} />
                </div>
                <div className="field">
                  <label>{t(lang, 'batch')}</label>
                  <input value={form.init_batch} onChange={set('init_batch')} placeholder="B1" />
                </div>
                <div className="field">
                  <label>{t(lang, 'supplier')}</label>
                  <select
                    className="field-select"
                    value={form.init_supplier}
                    onChange={(e) => setForm((f) => ({ ...f, init_supplier: e.target.value }))}
                  >
                    <option value="">—</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
          {error && <div className="error-box">{error}</div>}
          {msg && <div className="success-box">{msg}</div>}
          <button className="btn-save" type="submit" disabled={busy}>
            {busy ? t(lang, 'loading') : editingId ? t(lang, 'saveChanges') : t(lang, 'save')}
          </button>
          {editingId && (
            <button
              className="btn-secondary"
              type="button"
              onClick={cancelEdit}
              style={{ marginInlineStart: 8 }}
            >
              {t(lang, 'cancelBtn')}
            </button>
          )}
        </form>
      </div>
      )}

      <div className="panel">
        <div className="med-toolbar">
          <input
            className="search-input"
            placeholder={t(lang, 'search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={`chip ${stockFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStockFilter('all')}
          >
            {t(lang, 'allFilter')} ({rows.length})
          </button>
          <button
            type="button"
            className={`chip ${stockFilter === 'low' ? 'active' : ''}`}
            onClick={() => setStockFilter('low')}
          >
            {t(lang, 'lowStock')} ({lowCount})
          </button>
          <button
            type="button"
            className={`chip ${stockFilter === 'out' ? 'active' : ''}`}
            onClick={() => setStockFilter('out')}
          >
            {t(lang, 'outOfStock')} ({outCount})
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 15 }}>
            {t(lang, 'noMedicines')}
          </p>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'name')}</th>
                <th>{t(lang, 'company')}</th>
                <th>{t(lang, 'barcodeLabel')}</th>
                <th>{t(lang, 'unit')}</th>
                <th>{t(lang, 'category')}</th>
                <th>{t(lang, 'salePrice')}</th>
                <th>{t(lang, 'minStockLabel')}</th>
                <th>{t(lang, 'stockQty')}</th>
                <th>{t(lang, 'nearestExpiry')}</th>
                <th>{t(lang, 'dateAdded')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.medicine_id}
                  className={barcodeExact && r.barcode === barcodeExact ? 'highlight' : ''}
                >
                  <td style={{ whiteSpace: 'normal' }}>
                    <div>{r.name}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {r.generic_name || '—'}
                    </div>
                    {r.low_stock && <span className="badge low">{t(lang, 'lowBadge')}</span>}
                  </td>
                  <td>{r.company || '—'}</td>
                  <td>{r.barcode || '—'}</td>
                  <td>{r.unit}</td>
                  <td>{r.category || '—'}</td>
                  <td>{fmt(Number(r.sale_price))}</td>
                  <td>{fmt(Number(r.min_stock))}</td>
                  <td
                    className={
                      Number(r.total_quantity) === 0 ? 'qty-zero' : r.low_stock ? 'qty-low' : ''
                    }
                  >
                    {fmt(r.total_quantity)}
                  </td>
                  <td>{expiryCell(r)}</td>
                  <td>{String(r.created_at).slice(0, 10)}</td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => startEdit(r)}>
                      ✏️ {t(lang, 'edit')}
                    </button>{' '}
                    {confirmDeleteId === r.medicine_id ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ color: '#b91c1c', borderColor: '#b91c1c' }}
                        onClick={() => doDelete(r.medicine_id)}
                      >
                        {t(lang, 'sureDelete')}
                        {r.total_quantity > 0 ? ` (${fmt(r.total_quantity)})` : ''}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setConfirmDeleteId(r.medicine_id)}
                      >
                        🗑️ {t(lang, 'delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  );
}

function SalesPage({ lang, role, onAddMedicine }: { lang: Lang; role: string; onAddMedicine: (barcode: string) => void }) {
  // A cashier sells and views their own bills; returns, voids and credit
  // payments need a pharmacist or admin (the server enforces this too).
  const canManage = role !== 'cashier';
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
  const [paid, setPaid] = useState('');
  const [lastSaleId, setLastSaleId] = useState('');
  const [billQuery, setBillQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branch, setBranch] = useState<BranchInfo | null>(null);
  const [today, setToday] = useState<Summary | null>(null);
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMsg, setPayMsg] = useState('');
  const [payError, setPayError] = useState('');
  const [voidArm, setVoidArm] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Scanner-first till: the medicine search box is where scans land, so
  // after any click that is not inside a field (picking a result, the
  // quantity buttons, completing a sale, ...) the cursor returns to the
  // search box by itself — scanning never needs a click first.
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);
  const refocusOnClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    focusSearch();
  };

  const loadStock = async () => {
    const data = await api.get('/stock');
    setStock(data.stock as StockRow[]);
  };
  const loadToday = async () => {
    try {
      const data = await api.get('/reports/daily');
      setToday(data.summary as Summary);
    } catch {
      setToday(null);
    }
  };
  const loadRecent = async () => {
    const params = new URLSearchParams();
    if (billQuery.trim()) params.set('q', billQuery.trim());
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    const qs = params.toString();
    const data = await api.get(`/sales${qs ? `?${qs}` : ''}`);
    setRecent(data.sales as SaleRow[]);
  };

  useEffect(() => {
    loadStock().catch((err) => setError(err instanceof Error ? err.message : 'Error'));
    loadToday();
    api
      .get('/customers')
      .then((data) => setCustomers(data.customers as Customer[]))
      .catch(() => undefined);
    api
      .get('/settings/branch')
      .then((data) => setBranch(data.branch as BranchInfo))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadRecent().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billQuery, dateFrom, dateTo]);

  // Print the receipt as soon as it has rendered.
  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => {
      window.print();
      setReceipt(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [receipt]);

  const printSale = async (saleId: string) => {
    try {
      const data = await api.get(`/sales/${saleId}`);
      setReceipt(data.sale as SaleDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const q = query.trim().toLowerCase();
  const results = q
    ? stock.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.generic_name || '').toLowerCase().includes(q) ||
          (r.barcode || '').toLowerCase().includes(q)
      )
    : [];
  // A scanned code the system does not know: 8+ digits with no match.
  // (Cashiers cannot add medicines, so they only see "no results".)
  const scannedCode = query.trim();
  const unknownBarcode = canManage && q !== '' && results.length === 0 && /^\d{8,}$/.test(scannedCode);

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
    } else if (canManage && /^\d{8,}$/.test(code)) {
      // A scanned barcode the system does not know: open the add form
      // with the barcode already filled in.
      onAddMedicine(code);
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
  const totalItems = bill.reduce((sum, i) => sum + i.quantity, 0);
  const discountNum = discount === '' ? 0 : Number(discount) || 0;
  const net = Math.max(0, subtotal - discountNum);
  const paidNum = paid === '' ? net : Number(paid) || 0;
  const duePreview = Math.max(0, net - paidNum);

  const complete = async () => {
    setError('');
    setMsg('');
    if (bill.length === 0) {
      setError(t(lang, 'billEmpty'));
      return;
    }
    if (paidNum > net) {
      setError(`${t(lang, 'paidAmount')} > ${t(lang, 'netTotal')}`);
      return;
    }
    if (duePreview > 0 && !customerId) {
      setError(t(lang, 'creditNeedsCustomer'));
      return;
    }
    setBusy(true);
    try {
      const data = await api.post('/sales', {
        items: bill.map((i) => ({ medicine_id: i.medicine_id, quantity: i.quantity })),
        discount: discountNum,
        customer_id: customerId || undefined,
        paid_amount: paid === '' ? undefined : paidNum,
      });
      setMsg(
        `✅ ${t(lang, 'saleDone')}: ${data.sale.invoice_no} — ${fmt(Number(data.sale.net_total))} ${t(lang, 'currency')}`
      );
      setLastSaleId(data.sale.id as string);
      setBill([]);
      setDiscount('');
      setPaid('');
      setCustomerId('');
      await Promise.all([loadStock(), loadRecent(), loadToday()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setBusy(false);
  };

  // Till shortcuts: F2 focuses the search box, Ctrl+Enter completes the
  // sale, Escape closes an open bill detail or clears the search box.
  // The ref always holds the newest complete/detail so the one listener
  // registered below never works with stale values.
  const latest = useRef<{ complete: () => void; detail: SaleDetail | null }>({
    complete: () => {},
    detail: null,
  });
  latest.current = { complete, detail };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        focusSearch();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void latest.current.complete();
      } else if (e.key === 'Escape') {
        if (latest.current.detail) {
          setDetail(null);
        } else if (document.activeElement === searchRef.current) {
          setQuery('');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openReturn = async (saleId: string) => {
    setError('');
    setRetError('');
    setRetMsg('');
    setRetQtys({});
    setPayAmount('');
    setPayMsg('');
    setPayError('');
    setVoidArm(false);
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

  const detailDue = detail ? Number(detail.due_amount || 0) : 0;
  const detailAllReturned = detail
    ? detail.items.every((it) => it.returned_quantity >= it.quantity)
    : false;

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

  const submitPayment = async () => {
    if (!detail) return;
    setPayError('');
    setPayMsg('');
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError(t(lang, 'paidAmount'));
      return;
    }
    setRetBusy(true);
    try {
      await api.post(`/sales/${detail.id}/payment`, { amount });
      setPayMsg(t(lang, 'paymentDone'));
      setPayAmount('');
      const fresh = await api.get(`/sales/${detail.id}`);
      setDetail(fresh.sale as SaleDetail);
      await loadRecent();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Error');
    }
    setRetBusy(false);
  };

  const submitVoid = async () => {
    if (!detail) return;
    if (!voidArm) {
      setVoidArm(true);
      return;
    }
    setRetError('');
    setRetMsg('');
    setRetBusy(true);
    try {
      const data = await api.post(`/sales/${detail.id}/void`, {});
      setRetMsg(
        `${t(lang, 'voidedFull')} — ${t(lang, 'refundTotal')}: ${fmt(Number(data.refund_total))} ${t(lang, 'currency')}`
      );
      setVoidArm(false);
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
      <div className="dash-head">
        <h2>{t(lang, 'sales')}</h2>
        {today && (
          <span className="today-strip">
            {t(lang, 'todayRevenue')}: {fmt(Number(today.sales_count))} · {fmt(Number(today.revenue))}{' '}
            {t(lang, 'currency')}
          </span>
        )}
      </div>
      <div className="pos-grid" onClick={refocusOnClick}>
        <div className="panel" style={{ marginTop: 0 }}>
          <form onSubmit={onSearchSubmit}>
            <input
              ref={searchRef}
              className="search-input"
              placeholder={t(lang, 'searchMedicine')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </form>
          <p className="shortcut-hint">{t(lang, 'posShortcuts')}</p>
          {!q && (
            <div className="pos-hint">
              <div className="pos-hint-icon">🔍</div>
              <p>{t(lang, 'posHint')}</p>
            </div>
          )}
          {q && results.length === 0 && !unknownBarcode && (
            <p className="muted" style={{ fontSize: 15 }}>
              {t(lang, 'noResults')}
            </p>
          )}
          {unknownBarcode && (
            <div className="unknown-barcode">
              <p>
                {t(lang, 'unknownBarcode')}: <strong dir="ltr">{scannedCode}</strong>
              </p>
              <button className="btn-primary" onClick={() => onAddMedicine(scannedCode)}>
                ➕ {t(lang, 'addMedicineWithBarcode')}
              </button>
            </div>
          )}
          {results.map((r) => (
            <button key={r.medicine_id} className="result-row" onClick={() => addToBill(r)}>
              <span className="r-name">
                <span>{r.name}</span>
                {r.generic_name && <span className="r-generic">{r.generic_name}</span>}
              </span>
              <span
                className={`r-stock ${Number(r.total_quantity) === 0 ? 'qty-zero' : r.low_stock ? 'qty-low' : ''}`}
              >
                {t(lang, 'available')}: {fmt(r.total_quantity)}
              </span>
              <span className="r-price">
                {fmt(Number(r.sale_price))} {t(lang, 'currency')}
              </span>
            </button>
          ))}
        </div>

        <div className="panel pos-bill" style={{ marginTop: 0 }}>
          <h3>
            🧾 {t(lang, 'bill')}{' '}
            {bill.length > 0 && <span className="count-badge neutral">{totalItems}</span>}
          </h3>
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
                      <div className="qty-stepper">
                        <button type="button" onClick={() => setQty(i.medicine_id, i.quantity - 1)}>
                          −
                        </button>
                        <input
                          className="qty-input"
                          type="number"
                          min="1"
                          step="1"
                          value={i.quantity}
                          onChange={(e) => setQty(i.medicine_id, Number(e.target.value))}
                        />
                        <button type="button" onClick={() => setQty(i.medicine_id, i.quantity + 1)}>
                          +
                        </button>
                      </div>
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
            <span className="grand-amount">
              {fmt(net)} {t(lang, 'currency')}
            </span>
          </div>
          <div className="total-row">
            <span>{t(lang, 'paidAmount')}</span>
            <input
              className="discount-input"
              type="number"
              min="0"
              step="0.01"
              placeholder={fmt(net)}
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
            />
          </div>
          {duePreview > 0 && (
            <div className="total-row credit-preview">
              <span>
                {t(lang, 'dueAmount')} ({t(lang, 'credit')})
              </span>
              <span>
                {fmt(duePreview)} {t(lang, 'currency')}
              </span>
            </div>
          )}

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
          {bill.length > 0 && (
            <button
              className="btn-secondary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => {
                setBill([]);
                setDiscount('');
                setPaid('');
                setError('');
              }}
            >
              🗑️ {t(lang, 'clearBill')}
            </button>
          )}
          {lastSaleId && (
            <button
              className="btn-secondary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => printSale(lastSaleId)}
            >
              🧾 {t(lang, 'printReceipt')}
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>
          🧾 {t(lang, 'recentBills')} <span className="count-badge neutral">{recent.length}</span>
        </h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input
            className="field-select"
            style={{ flex: '1 1 220px' }}
            placeholder={t(lang, 'searchBillsPh')}
            value={billQuery}
            onChange={(e) => setBillQuery(e.target.value)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted">{t(lang, 'fromDate')}</span>
            <input
              className="field-select"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted">{t(lang, 'toDate')}</span>
            <input
              className="field-select"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
        {recent.length === 0 ? (
          <p className="muted">—</p>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'invoice')}</th>
                <th>{t(lang, 'customer')}</th>
                <th>{t(lang, 'seller')}</th>
                <th>{t(lang, 'lineTotal')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => {
                const soldQty = Number(s.items_sold || 0);
                const retQty = Number(s.items_returned || 0);
                const refunded = Number(s.refunded_total || 0);
                const fullyReturned = soldQty > 0 && retQty >= soldQty;
                const partiallyReturned = retQty > 0 && !fullyReturned;
                const displayTotal = Math.max(0, Number(s.net_total) - refunded);
                const due = Number(s.due_amount || 0);
                const isVoided = Number(s.voided || 0) === 1;
                return (
                  <tr key={s.id} style={fullyReturned || isVoided ? { opacity: 0.65 } : undefined}>
                    <td>
                      {s.invoice_no}
                      <span className="muted">
                        {' '}
                        · {String(s.sale_date).slice(0, 10)} {String(s.sale_date).slice(11, 16)}
                      </span>{' '}
                      {isVoided ? (
                        <span className="badge expired">🚫 {t(lang, 'voidedFull')}</span>
                      ) : fullyReturned ? (
                        <span className="badge returned">↩️ {t(lang, 'returnedFull')}</span>
                      ) : partiallyReturned ? (
                        <span className="badge warning">↩️ {t(lang, 'returnedPartial')}</span>
                      ) : null}
                    </td>
                    <td>{s.customer_name || t(lang, 'walkIn')}</td>
                    <td>{s.seller_name || '—'}</td>
                    <td>
                      {fmt(displayTotal)}
                      {due > 0 && (
                        <>
                          {' '}
                          <span className="badge warning">
                            {t(lang, 'credit')}: {fmt(due)}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-secondary" onClick={() => printSale(s.id)}>
                          🧾 {t(lang, 'printReceipt')}
                        </button>
                        {canManage ? (
                          !fullyReturned &&
                          !isVoided && (
                            <button className="btn-secondary" onClick={() => openReturn(s.id)}>
                              ↩️ {t(lang, 'returnSale')}
                            </button>
                          )
                        ) : (
                          <button className="btn-secondary" onClick={() => openReturn(s.id)}>
                            👁️ {t(lang, 'viewBtn')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="panel">
          <h3>
            ↩️ {t(lang, 'billDetails')} — {detail.invoice_no}
            <span className="muted" style={{ fontSize: 14 }}>
              {' '}
              · {detail.customer_name || t(lang, 'walkIn')} · {t(lang, 'seller')}:{' '}
              {detail.seller_name || '—'} · {fmt(Number(detail.net_total))}{' '}
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
                {canManage && <th>{t(lang, 'returnQty')}</th>}
                {canManage && <th>{t(lang, 'lineTotal')}</th>}
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
                    {canManage && (
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
                    )}
                    {canManage && <td>{fmt(rq * Number(it.unit_price))}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {canManage && (
            <div className="total-row grand">
              <span>{t(lang, 'refundTotal')}</span>
              <span>
                {fmt(refundPreview)} {t(lang, 'currency')}
              </span>
            </div>
          )}

          <div className="total-row">
            <span>{t(lang, 'paidTotal')}</span>
            <span>
              {fmt(Number(detail.paid_total || 0))} {t(lang, 'currency')}
            </span>
          </div>
          {detailDue > 0 && (
            <div className="total-row">
              <span>
                {t(lang, 'dueAmount')} ({t(lang, 'credit')})
              </span>
              <span>
                {fmt(detailDue)} {t(lang, 'currency')}
              </span>
            </div>
          )}
          {(detail.payments || []).map((p) => (
            <div className="total-row" key={p.id}>
              <span className="muted">
                💵 {String(p.created_at).slice(0, 10)} {String(p.created_at).slice(11, 16)}
              </span>
              <span>
                {fmt(Number(p.amount))} {t(lang, 'currency')}
              </span>
            </div>
          ))}

          {canManage && detailDue > 0 && !detail.voided_at && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input
                className="discount-input"
                type="number"
                min="0"
                step="0.01"
                placeholder={t(lang, 'paidAmount')}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <button className="btn-secondary" onClick={submitPayment} disabled={retBusy}>
                💵 {t(lang, 'recordPayment')}
              </button>
            </div>
          )}
          {payError && <div className="error-box">{payError}</div>}
          {payMsg && <div className="success-box">{payMsg}</div>}

          {retError && <div className="error-box">{retError}</div>}
          {retMsg && <div className="success-box">{retMsg}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {canManage && (
              <button className="btn-save" onClick={submitReturn} disabled={retBusy}>
                {retBusy ? t(lang, 'loading') : t(lang, 'doReturn')}
              </button>
            )}
            <button className="btn-secondary" onClick={() => setReceipt(detail)} disabled={retBusy}>
              🧾 {t(lang, 'printReceipt')}
            </button>
            {detail.voided_at ? (
              <span className="badge expired">🚫 {t(lang, 'voidedFull')}</span>
            ) : canManage && !detailAllReturned ? (
              <button
                className={voidArm ? 'btn-danger armed' : 'btn-danger'}
                onClick={submitVoid}
                disabled={retBusy}
              >
                {voidArm ? `⚠️ ${t(lang, 'confirmVoidQ')}` : `🚫 ${t(lang, 'voidBill')}`}
              </button>
            ) : null}
            <button className="btn-secondary" onClick={() => setDetail(null)} disabled={retBusy}>
              {t(lang, 'closeBtn')}
            </button>
          </div>
        </div>
      )}

      {receipt &&
        createPortal(
          <div id="receipt-print">
          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{branch?.name || 'Pharmacy'}</div>
            {branch?.address && <div>{branch.address}</div>}
            {branch?.phone && <div>{branch.phone}</div>}
          </div>
          <div style={{ borderTop: '1px dashed #000', paddingTop: 4 }}>
            <div>
              {t(lang, 'invoice')}: {receipt.invoice_no}
            </div>
            <div>
              {String(receipt.sale_date).slice(0, 10)} {String(receipt.sale_date).slice(11, 16)}
            </div>
            <div>
              {t(lang, 'customer')}: {receipt.customer_name || t(lang, 'walkIn')}
            </div>
            {receipt.seller_name && (
              <div>
                {t(lang, 'seller')}: {receipt.seller_name}
              </div>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <tbody>
              {receipt.items.map((it) => (
                <tr key={it.item_id}>
                  <td style={{ padding: '2px 0' }}>
                    {it.medicine_name}
                    <br />
                    <span>
                      {fmt(it.quantity)} × {fmt(Number(it.unit_price))}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', verticalAlign: 'top', padding: '2px 0' }}>
                    {fmt(it.quantity * Number(it.unit_price))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ borderTop: '1px dashed #000', marginTop: 6, paddingTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t(lang, 'subtotal')}</span>
              <span>{fmt(Number(receipt.total_amount))}</span>
            </div>
            {Number(receipt.discount) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{t(lang, 'discount')}</span>
                <span>−{fmt(Number(receipt.discount))}</span>
              </div>
            )}
            <div
              style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}
            >
              <span>{t(lang, 'netTotal')}</span>
              <span>
                {fmt(Number(receipt.net_total))} {t(lang, 'currency')}
              </span>
            </div>
            {Number(receipt.refunded_total || 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{t(lang, 'returnedFull')}</span>
                <span>−{fmt(Number(receipt.refunded_total || 0))}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t(lang, 'paidTotal')}</span>
              <span>{fmt(Number(receipt.paid_total || 0))}</span>
            </div>
            {Number(receipt.due_amount || 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>{t(lang, 'dueAmount')}</span>
                <span>{fmt(Number(receipt.due_amount || 0))}</span>
              </div>
            )}
            {receipt.voided_at && (
              <div style={{ textAlign: 'center', fontWeight: 700, marginTop: 4 }}>
                🚫 {t(lang, 'voidedFull')}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center', marginTop: 8 }}>{t(lang, 'thankYou')}</div>
          </div>,
          document.body
        )}
    </>
  );
}

function SuppliersPage({ lang }: { lang: Lang }) {
  const [list, setList] = useState<SupplierRow[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [eName, setEName] = useState('');
  const [ePhone, setEPhone] = useState('');
  const [eAddress, setEAddress] = useState('');
  const [editMsg, setEditMsg] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMsg, setPayMsg] = useState('');
  const [payError, setPayError] = useState('');
  const [supFormOpen, setSupFormOpen] = useState(false);
  const [scrollToDetail, setScrollToDetail] = useState(false);
  const [delArm, setDelArm] = useState('');
  const detailRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const data = await api.get('/suppliers');
    setList(data.suppliers as SupplierRow[]);
  };
  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Error'));
  }, []);

  // After an Edit click from the list, bring the account panel (with the
  // edit form) into view once it has loaded. Refreshes after a save or a
  // payment do not scroll — the flag is only set by the Edit button.
  useEffect(() => {
    if (detail && scrollToDetail) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollToDetail(false);
    }
  }, [detail, scrollToDetail]);

  const editFromList = (id: string) => {
    setScrollToDetail(true);
    openDetail(id);
  };

  const doDelete = async (id: string) => {
    setError('');
    setMsg('');
    try {
      await api.del(`/suppliers/${id}`);
      setMsg(`✅ ${t(lang, 'supplierDeleted')}`);
      setDelArm('');
      if (detail && detail.id === id) setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
      setDelArm('');
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!validPhone(phone)) {
      setError(t(lang, 'phoneInvalid'));
      return;
    }
    try {
      await api.post('/suppliers', {
        name: name.trim(),
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
      });
      setMsg(`✅ ${t(lang, 'supplierAdded')}`);
      setName('');
      setPhone('');
      setAddress('');
      setSupFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const openDetail = async (id: string) => {
    setPayMsg('');
    setPayError('');
    setEditMsg('');
    setPayAmount('');
    try {
      const data = await api.get(`/suppliers/${id}`);
      const s = data.supplier as SupplierDetail;
      setDetail(s);
      setEName(s.name);
      setEPhone(s.phone || '');
      setEAddress(s.address || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setEditMsg('');
    if (!validPhone(ePhone)) {
      setEditMsg(t(lang, 'phoneInvalid'));
      return;
    }
    try {
      await api.put(`/suppliers/${detail.id}`, {
        name: eName.trim(),
        phone: ePhone.trim() || undefined,
        address: eAddress.trim() || undefined,
      });
      setEditMsg(`✅ ${t(lang, 'saved')}`);
      await Promise.all([load(), openDetail(detail.id)]);
    } catch (err) {
      setEditMsg(err instanceof Error ? err.message : 'Error');
    }
  };

  const recordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setPayMsg('');
    setPayError('');
    const amount = Number(payAmount);
    if (!payAmount || !Number.isFinite(amount) || amount <= 0) {
      setPayError(t(lang, 'paidAmount'));
      return;
    }
    try {
      await api.post(`/suppliers/${detail.id}/payment`, { amount });
      setPayMsg(`✅ ${t(lang, 'paymentRecorded')}`);
      setPayAmount('');
      await Promise.all([load(), openDetail(detail.id)]);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Error');
    }
  };

  const shown = list.filter(
    (s) => !query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const totalPurchased = list.reduce((s, r) => s + Number(r.purchases_total || 0), 0);
  const totalPaid = list.reduce((s, r) => s + Number(r.paid_total || 0), 0);
  const totalDue = list.reduce((s, r) => s + Number(r.due_total || 0), 0);

  return (
    <>
      <div className="dash-head">
        <h2>
          {t(lang, 'suppliers')} <span className="count-badge neutral">{list.length}</span>
        </h2>
        {!supFormOpen && (
          <button
            className="btn-primary"
            style={{ width: 'auto', marginTop: 0 }}
            onClick={() => {
              setError('');
              setMsg('');
              setSupFormOpen(true);
            }}
          >
            🏭 {t(lang, 'addSupplier')}
          </button>
        )}
      </div>
      <div className="cards dash-cards">
        <div className="card dash-card accent-blue">
          <div className="card-top">
            <span className="card-icon">🏭</span>
            <span className="card-label">{t(lang, 'suppliers')}</span>
          </div>
          <div className="card-value">{fmt(list.length)}</div>
        </div>
        <div className="card dash-card accent-purple">
          <div className="card-top">
            <span className="card-icon">📦</span>
            <span className="card-label">{t(lang, 'totalPurchased')}</span>
          </div>
          <div className="card-value">{fmt(totalPurchased)}</div>
          <div className="card-sub">{t(lang, 'currency')}</div>
        </div>
        <div className="card dash-card accent-teal">
          <div className="card-top">
            <span className="card-icon">💵</span>
            <span className="card-label">{t(lang, 'paidAmount')}</span>
          </div>
          <div className="card-value">{fmt(totalPaid)}</div>
          <div className="card-sub">{t(lang, 'currency')}</div>
        </div>
        <div className="card dash-card accent-amber">
          <div className="card-top">
            <span className="card-icon">⚠️</span>
            <span className="card-label">{t(lang, 'due')}</span>
          </div>
          <div className="card-value">{fmt(totalDue)}</div>
          <div className="card-sub">{t(lang, 'currency')}</div>
        </div>
      </div>
      {msg && <div className="success-box">{msg}</div>}
      {error && <div className="error-box">{error}</div>}

      {supFormOpen && (
      <div className="panel">
        <h3>🏭 {t(lang, 'addSupplier')}</h3>
        <form onSubmit={add}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'name')} *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>{t(lang, 'phone')}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={10} inputMode="numeric" />
            </div>
            <div className="field">
              <label>{t(lang, 'address')}</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
          <button className="btn-secondary" type="submit">
            {t(lang, 'save')}
          </button>{' '}
          <button className="btn-secondary" type="button" onClick={() => setSupFormOpen(false)}>
            {t(lang, 'cancel')}
          </button>
        </form>
      </div>
      )}

      <div className="panel">
        <input
          className="search-input"
          placeholder={t(lang, 'suppliers')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t(lang, 'name')}</th>
                <th>{t(lang, 'phone')}</th>
                <th>{t(lang, 'totalPurchased')}</th>
                <th>{t(lang, 'paidAmount')}</th>
                <th>{t(lang, 'due')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.phone || '—'}</td>
                  <td>{fmt(Number(s.purchases_total))}</td>
                  <td>{fmt(Number(s.paid_total))}</td>
                  <td>
                    {Number(s.due_total) > 0 ? (
                      <span className="badge warning">
                        {t(lang, 'due')}: {fmt(Number(s.due_total))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small" onClick={() => editFromList(s.id)}>
                      {t(lang, 'edit')}
                    </button>{' '}
                    <button className="btn small" onClick={() => openDetail(s.id)}>
                      {t(lang, 'supplierAccount')}
                    </button>{' '}
                    {delArm === s.id ? (
                      <button className="btn small btn-danger armed" onClick={() => doDelete(s.id)}>
                        {t(lang, 'confirmDeleteIt')}
                      </button>
                    ) : (
                      <button
                        className="btn small btn-danger"
                        onClick={() => {
                          setError('');
                          setMsg('');
                          setDelArm(s.id);
                        }}
                      >
                        {t(lang, 'delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {t(lang, 'noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="panel" ref={detailRef}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>
              {t(lang, 'supplierAccount')}: {detail.name}
            </h3>
            <button className="btn small" onClick={() => setDetail(null)}>
              ✕
            </button>
          </div>
          <div className="detail-stats">
            <div className="detail-stat">
              <span className="detail-stat-label">{t(lang, 'totalPurchased')}</span>
              <span className="detail-stat-value">
                {fmt(Number(detail.purchases_total))} {t(lang, 'currency')}
              </span>
            </div>
            <div className="detail-stat">
              <span className="detail-stat-label">{t(lang, 'paidAmount')}</span>
              <span className="detail-stat-value">
                {fmt(Number(detail.paid_total))} {t(lang, 'currency')}
              </span>
            </div>
            <div className="detail-stat">
              <span className="detail-stat-label">{t(lang, 'due')}</span>
              <span
                className={`detail-stat-value ${Number(detail.due_total) > 0 ? 'qty-low' : ''}`}
              >
                {fmt(Number(detail.due_total))} {t(lang, 'currency')}
              </span>
            </div>
          </div>

          <form onSubmit={saveEdit}>
            <div className="form-grid">
              <div className="field">
                <label>{t(lang, 'name')} *</label>
                <input value={eName} onChange={(e) => setEName(e.target.value)} />
              </div>
              <div className="field">
                <label>{t(lang, 'phone')}</label>
                <input value={ePhone} onChange={(e) => setEPhone(e.target.value)} maxLength={10} inputMode="numeric" />
              </div>
              <div className="field">
                <label>{t(lang, 'address')}</label>
                <input value={eAddress} onChange={(e) => setEAddress(e.target.value)} />
              </div>
            </div>
            <button className="btn-secondary" type="submit">
              {t(lang, 'save')}
            </button>
            {editMsg && <span style={{ marginInlineStart: 10 }}>{editMsg}</span>}
          </form>

          {Number(detail.due_total) > 0 && (
            <form
              onSubmit={recordPayment}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 14 }}
            >
              <div className="field" style={{ maxWidth: 220 }}>
                <label>{t(lang, 'paidAmount')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <button className="btn-save" type="submit">
                {t(lang, 'recordPayment')}
              </button>
              {payMsg && <span style={{ marginInlineStart: 4 }}>{payMsg}</span>}
              {payError && <span style={{ marginInlineStart: 4 }}>{payError}</span>}
            </form>
          )}

          {detail.payments.length > 0 && (
            <>
              <h4>{t(lang, 'paymentsHistory')}</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t(lang, 'date')}</th>
                    <th>{t(lang, 'paidAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{String(p.created_at).slice(0, 10)}</td>
                      <td>{fmt(Number(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h4>{t(lang, 'purchasesHistory')}</h4>
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t(lang, 'invoiceNo')}</th>
                <th>{t(lang, 'date')}</th>
                <th>{t(lang, 'netTotal')}</th>
                <th>{t(lang, 'paidAmount')}</th>
                <th>{t(lang, 'due')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.purchases.map((p) => {
                const netP = Number(p.total_amount) - Number(p.returned_total || 0);
                const dueP = Math.max(0, netP - Number(p.paid_amount));
                return (
                  <tr key={p.id}>
                    <td>
                      {p.invoice_no || '—'}{' '}
                      {Number(p.returned_total || 0) > 0 && (
                        <span className="badge warning">↩️ {t(lang, 'returnedPartial')}</span>
                      )}
                    </td>
                    <td>{String(p.purchase_date).slice(0, 10)}</td>
                    <td>{fmt(netP)}</td>
                    <td>{fmt(Number(p.paid_amount))}</td>
                    <td className={dueP > 0 ? 'qty-low' : 'muted'}>{dueP > 0 ? fmt(dueP) : '—'}</td>
                  </tr>
                );
              })}
              {detail.purchases.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t(lang, 'noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
  const [supError, setSupError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [delArm, setDelArm] = useState('');
  const [listError, setListError] = useState('');
  const [listMsg, setListMsg] = useState('');
  const [purQuery, setPurQuery] = useState('');
  const [purFrom, setPurFrom] = useState('');
  const [purTo, setPurTo] = useState('');
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [retQtys, setRetQtys] = useState<Record<string, string>>({});
  const [retError, setRetError] = useState('');
  const [retMsg, setRetMsg] = useState('');
  const [retBusy, setRetBusy] = useState(false);
  const [dupWarn, setDupWarn] = useState(false);
  const [supFormOpen, setSupFormOpen] = useState(false);

  const loadSuppliers = async () => {
    const data = await api.get('/suppliers');
    setSuppliers(data.suppliers as Supplier[]);
  };
  const loadPurchases = async () => {
    const params = new URLSearchParams();
    if (purQuery.trim()) params.set('q', purQuery.trim());
    if (purFrom) params.set('from', purFrom);
    if (purTo) params.set('to', purTo);
    const qs = params.toString();
    const data = await api.get(`/purchases${qs ? `?${qs}` : ''}`);
    setPurchases(data.purchases as PurchaseRow[]);
  };

  useEffect(() => {
    api
      .get('/medicines')
      .then((data) => setMeds(data.medicines as MedOption[]))
      .catch((err) => setError(err instanceof Error ? err.message : 'Error'));
    loadSuppliers().catch(() => undefined);
    loadPurchases().catch(() => undefined);
  }, []);

  const resetForm = () => {
    setRows([{ medicine_id: '', batch_no: '', expiry_date: '', quantity: '1', purchase_price: '' }]);
    setInvoiceNo('');
    setPaid('');
    setSupplierId('');
    setEditingId('');
    setDupWarn(false);
  };

  const startEdit = async (p: PurchaseRow) => {
    setError('');
    setMsg('');
    setListError('');
    setListMsg('');
    try {
      const data = await api.get(`/purchases/${p.id}`);
      const pur = data.purchase as {
        supplier_id: string | null;
        invoice_no: string | null;
        paid_amount: number | string;
        items: {
          id: string;
          medicine_id: string;
          batch_no: string;
          expiry_date: string;
          quantity: number;
          purchase_price: number | string;
        }[];
      };
      setSupplierId(pur.supplier_id || '');
      setInvoiceNo(pur.invoice_no || '');
      setPaid(String(pur.paid_amount));
      setRows(
        pur.items.map((it) => ({
          id: it.id,
          medicine_id: it.medicine_id,
          batch_no: it.batch_no,
          expiry_date: String(it.expiry_date).slice(0, 10),
          quantity: String(it.quantity),
          purchase_price: String(it.purchase_price),
        }))
      );
      setEditingId(p.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Error');
    }
  };

  const doDelete = async (id: string) => {
    setListError('');
    setListMsg('');
    try {
      await api.del(`/purchases/${id}`);
      setListMsg(`✅ ${t(lang, 'purchaseDeleted')}`);
      setDelArm('');
      if (editingId === id) resetForm();
      await loadPurchases();
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Error');
      setDelArm('');
    }
  };

  useEffect(() => {
    loadPurchases().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purQuery, purFrom, purTo]);

  const openDetail = async (id: string) => {
    setRetQtys({});
    setRetError('');
    setRetMsg('');
    try {
      const data = await api.get(`/purchases/${id}`);
      setDetail(data.purchase as PurchaseDetail);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Error');
    }
  };

  const submitReturn = async () => {
    if (!detail) return;
    setRetError('');
    setRetMsg('');
    const items = detail.items
      .map((it) => ({ purchase_item_id: it.id, quantity: Number(retQtys[it.id] || 0) }))
      .filter((x) => x.quantity > 0);
    if (items.length === 0) {
      setRetError(t(lang, 'returnQty'));
      return;
    }
    setRetBusy(true);
    try {
      const data = await api.post(`/purchases/${detail.id}/return`, { items });
      setRetMsg(
        `✅ ${t(lang, 'returnDone')} — ${fmt(Number(data.returned_total))} ${t(lang, 'currency')}`
      );
      await Promise.all([openDetail(detail.id), loadPurchases()]);
    } catch (err) {
      setRetError(err instanceof Error ? err.message : 'Error');
    }
    setRetBusy(false);
  };

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
  // Due preview only once a paid amount has actually been typed.
  const duePreview = paid !== '' ? Math.max(0, total - (Number(paid) || 0)) : 0;
  const detailDue = detail
    ? Math.max(
        0,
        Number(detail.total_amount) - Number(detail.returned_total || 0) - Number(detail.paid_amount)
      )
    : 0;

  // Entry-time expiry warning: a row whose expiry is already past, or at most
  // 90 days away, is named here BEFORE saving. Warning only — never a block.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const expiryWarnings = rows
    .filter((r) => r.medicine_id && r.expiry_date)
    .map((r) => ({
      name: meds.find((m) => m.id === r.medicine_id)?.name || '',
      date: r.expiry_date,
      days: Math.round(
        (new Date(`${r.expiry_date}T00:00:00`).getTime() - todayStart.getTime()) / 86400000
      ),
    }))
    .filter((w) => w.days <= 90);

  // Tint the expiry cell itself at the field: amber ≤90 days, red when past.
  const expiryCellClass = (dateStr: string) => {
    if (!dateStr) return '';
    const days = Math.round(
      (new Date(`${dateStr}T00:00:00`).getTime() - todayStart.getTime()) / 86400000
    );
    if (days < 0) return 'cell-past';
    if (days <= 90) return 'cell-warn';
    return '';
  };

  const addSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSupMsg('');
    setSupError('');
    if (!supName.trim()) return;
    if (!validPhone(supPhone)) {
      setSupError(t(lang, 'phoneInvalid'));
      return;
    }
    try {
      await api.post('/suppliers', { name: supName.trim(), phone: supPhone.trim() || undefined });
      setSupMsg(t(lang, 'supplierAdded'));
      setSupName('');
      setSupPhone('');
      setSupFormOpen(false);
      await loadSuppliers();
    } catch (err) {
      setSupError(err instanceof Error ? err.message : 'Error');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const payload = {
        supplier_id: supplierId || undefined,
        invoice_no: invoiceNo.trim() || undefined,
        allow_duplicate: dupWarn || undefined,
        paid_amount: paid === '' ? undefined : Number(paid),
        items: rows
          .filter((r) => r.medicine_id)
          .map((r) => ({
            ...(r.id ? { id: r.id } : {}),
            medicine_id: r.medicine_id,
            batch_no: r.batch_no.trim(),
            expiry_date: r.expiry_date,
            quantity: Number(r.quantity),
            purchase_price: r.purchase_price === '' ? 0 : Number(r.purchase_price),
          })),
      };
      if (editingId) {
        const data = await api.put(`/purchases/${editingId}`, payload);
        setMsg(
          `✅ ${t(lang, 'purchaseUpdated')}: ${data.purchase.invoice_no || ''} — ${fmt(Number(data.purchase.total_amount))} ${t(lang, 'currency')}`
        );
        resetForm();
      } else {
        const data = await api.post('/purchases', payload);
        setMsg(
          `✅ ${t(lang, 'purchaseDone')}: ${data.purchase.invoice_no || ''} — ${fmt(Number(data.purchase.total_amount))} ${t(lang, 'currency')}`
        );
        setRows([{ medicine_id: '', batch_no: '', expiry_date: '', quantity: '1', purchase_price: '' }]);
        setInvoiceNo('');
        setPaid('');
      }
      await loadPurchases();
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Error';
      if (m.startsWith('DUPLICATE_INVOICE')) {
        setDupWarn(true);
      } else {
        setError(m);
      }
    }
    setBusy(false);
  };

  return (
    <>
      <div className="dash-head">
        <h2>{t(lang, 'purchases')}</h2>
        {!supFormOpen && (
          <button
            className="btn-primary"
            style={{ width: 'auto', marginTop: 0 }}
            onClick={() => {
              setSupError('');
              setSupMsg('');
              setSupFormOpen(true);
            }}
          >
            🏭 {t(lang, 'addSupplier')}
          </button>
        )}
      </div>
      {supMsg && <div className="success-box">{supMsg}</div>}

      {supFormOpen && (
      <div className="panel">
        <h3>🏭 {t(lang, 'addSupplier')}</h3>
        <form onSubmit={addSupplier}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'name')} *</label>
              <input value={supName} onChange={(e) => setSupName(e.target.value)} />
            </div>
            <div className="field">
              <label>{t(lang, 'phone')}</label>
              <input value={supPhone} onChange={(e) => setSupPhone(e.target.value)} maxLength={10} inputMode="numeric" />
            </div>
          </div>
          {supError && <div className="error-box">{supError}</div>}
          <button className="btn-secondary" type="submit">
            {t(lang, 'save')}
          </button>{' '}
          <button className="btn-secondary" type="button" onClick={() => setSupFormOpen(false)}>
            {t(lang, 'cancel')}
          </button>
        </form>
      </div>
      )}

      <div className="panel">
        <h3>📦 {editingId ? t(lang, 'editPurchase') : t(lang, 'newPurchase')}</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'supplier')}</label>
              <select
                className="field-select"
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  setDupWarn(false);
                }}
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
              <input
                value={invoiceNo}
                onChange={(e) => {
                  setInvoiceNo(e.target.value);
                  setDupWarn(false);
                }}
              />
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
                      className={`cell-input ${expiryCellClass(r.expiry_date)}`}
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
                  <td className="line-total-cell">
                    {fmt((Number(r.quantity) || 0) * (Number(r.purchase_price) || 0))}
                  </td>
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
            <span className="grand-amount">
              {fmt(total)} {t(lang, 'currency')}
            </span>
          </div>
          {duePreview > 0 && (
            <div className="total-row credit-preview">
              <span>{t(lang, 'dueAmount')}</span>
              <span>
                {fmt(duePreview)} {t(lang, 'currency')}
              </span>
            </div>
          )}

          {expiryWarnings.length > 0 && (
            <div className="error-box">
              {expiryWarnings.map((w, i) => (
                <div key={i}>
                  ⚠️ {w.name} — {t(lang, 'expiryDate')}: {w.date} —{' '}
                  {w.days < 0
                    ? t(lang, 'expiryPastWarn')
                    : `${t(lang, 'expirySoonWarn')} — ${w.days} ${t(lang, 'daysWord')}`}
                </div>
              ))}
            </div>
          )}
          {dupWarn && (
            <div className="error-box">
              ⚠️ {t(lang, 'duplicateInvoiceWarn')}: {invoiceNo}
            </div>
          )}
          {error && <div className="error-box">{error}</div>}
          {msg && <div className="success-box">{msg}</div>}
          <button className="btn-save" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy
              ? t(lang, 'loading')
              : dupWarn
                ? `⚠️ ${t(lang, 'saveAnyway')}`
                : editingId
                  ? t(lang, 'saveChanges')
                  : t(lang, 'completePurchase')}
          </button>
          {editingId && (
            <button
              className="btn-secondary"
              type="button"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => {
                resetForm();
                setError('');
                setMsg('');
              }}
            >
              {t(lang, 'cancel')}
            </button>
          )}
        </form>
      </div>

      <div className="panel">
        <h3>
          📦 {t(lang, 'recentPurchases')} <span className="count-badge neutral">{purchases.length}</span>
        </h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input
            className="field-select"
            style={{ flex: '1 1 220px' }}
            placeholder={t(lang, 'searchPurchase')}
            value={purQuery}
            onChange={(e) => setPurQuery(e.target.value)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted">{t(lang, 'fromDate')}</span>
            <input
              className="field-select"
              type="date"
              value={purFrom}
              onChange={(e) => setPurFrom(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted">{t(lang, 'toDate')}</span>
            <input
              className="field-select"
              type="date"
              value={purTo}
              onChange={(e) => setPurTo(e.target.value)}
            />
          </label>
        </div>
        {listError && <div className="error-box">{listError}</div>}
        {listMsg && <div className="success-box">{listMsg}</div>}
        {purchases.length === 0 ? (
          <p className="muted">—</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t(lang, 'invoiceNo')}</th>
                  <th>{t(lang, 'supplier')}</th>
                  <th>{t(lang, 'dateLabel')}</th>
                  <th>{t(lang, 'lineTotal')}</th>
                  <th>{t(lang, 'paidAmount')}</th>
                  <th>{t(lang, 'due')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => {
                  const returned = Number(p.returned_total || 0);
                  const net = Number(p.total_amount) - returned;
                  const due = Math.max(0, net - Number(p.paid_amount));
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.invoice_no || '—'}{' '}
                        {returned > 0 &&
                          (net <= 0 ? (
                            <span className="badge returned">↩️ {t(lang, 'returnedFull')}</span>
                          ) : (
                            <span className="badge warning">↩️ {t(lang, 'returnedPartial')}</span>
                          ))}
                      </td>
                      <td>{p.supplier_name || '—'}</td>
                      <td>{String(p.purchase_date).slice(0, 10)}</td>
                      <td>{fmt(net)}</td>
                      <td>{fmt(Number(p.paid_amount))}</td>
                      <td className={due > 0 ? 'qty-low' : 'muted'}>{due > 0 ? fmt(due) : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn small" onClick={() => openDetail(p.id)}>
                          {t(lang, 'purchaseDetails')}
                        </button>{' '}
                        <button className="btn small" onClick={() => startEdit(p)}>
                          {t(lang, 'edit')}
                        </button>{' '}
                        {delArm === p.id ? (
                          <button className="btn small btn-danger armed" onClick={() => doDelete(p.id)}>
                            {t(lang, 'confirmDelete')}
                          </button>
                        ) : (
                          <button
                            className="btn small btn-danger"
                            onClick={() => {
                              setListError('');
                              setListMsg('');
                              setDelArm(p.id);
                            }}
                          >
                            {t(lang, 'delete')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>
              {t(lang, 'purchaseDetails')}: {detail.invoice_no || '—'} · {detail.supplier_name || '—'}
            </h3>
            <button className="btn small" onClick={() => setDetail(null)}>
              ✕
            </button>
          </div>
          <div className="detail-stats">
            <div className="detail-stat">
              <span className="detail-stat-label">{t(lang, 'lineTotal')}</span>
              <span className="detail-stat-value">
                {fmt(Number(detail.total_amount) - Number(detail.returned_total || 0))}{' '}
                {t(lang, 'currency')}
              </span>
            </div>
            <div className="detail-stat">
              <span className="detail-stat-label">{t(lang, 'paidAmount')}</span>
              <span className="detail-stat-value">
                {fmt(Number(detail.paid_amount))} {t(lang, 'currency')}
              </span>
            </div>
            <div className="detail-stat">
              <span className="detail-stat-label">{t(lang, 'due')}</span>
              <span className={`detail-stat-value ${detailDue > 0 ? 'qty-low' : ''}`}>
                {fmt(detailDue)} {t(lang, 'currency')}
              </span>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>{t(lang, 'name')}</th>
                <th>{t(lang, 'batch')}</th>
                <th>{t(lang, 'expiryDate')}</th>
                <th>{t(lang, 'quantity')}</th>
                <th>{t(lang, 'returnedQty')}</th>
                <th>{t(lang, 'remaining')}</th>
                <th>{t(lang, 'returnQty')}</th>
                <th>{t(lang, 'purchasePrice')}</th>
                <th>{t(lang, 'lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((it) => {
                const maxRet = Number(it.quantity) - Number(it.returned_quantity);
                return (
                  <tr key={it.id}>
                    <td>{it.medicine_name}</td>
                    <td>{it.batch_no}</td>
                    <td>{String(it.expiry_date).slice(0, 10)}</td>
                    <td>{it.quantity}</td>
                    <td>{Number(it.returned_quantity) || '—'}</td>
                    <td>{maxRet}</td>
                    <td>
                      {maxRet > 0 ? (
                        <input
                          className="cell-input"
                          style={{ width: 64 }}
                          type="number"
                          min={0}
                          max={maxRet}
                          value={retQtys[it.id] || ''}
                          onChange={(e) => setRetQtys((s) => ({ ...s, [it.id]: e.target.value }))}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{fmt(Number(it.purchase_price))}</td>
                    <td>{fmt(Number(it.quantity) * Number(it.purchase_price))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {retError && <div className="error-box">{retError}</div>}
          {retMsg && <div className="success-box">{retMsg}</div>}
          <button className="btn primary" onClick={submitReturn} disabled={retBusy}>
            ↩️ {t(lang, 'returnToSupplier')}
          </button>
        </div>
      )}
    </>
  );
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Simple CSS bar chart for the reports: revenue (grey) and profit
// (green, red when negative) per day or month. No chart library — the
// bars are divs, so it works offline and adds no weight. Exact figures
// stay in the table below it; hovering a column shows both values.
function BarChart({
  points,
  revLabel,
  profitLabel,
}: {
  points: { label: string; revenue: number; profit: number }[];
  revLabel: string;
  profitLabel: string;
}) {
  const max = Math.max(1, ...points.map((p) => Math.max(p.revenue, Math.abs(p.profit))));
  const showLabels = points.length <= 31;
  const showValues = points.length <= 20;
  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span>
          <i className="dot dot-rev" /> {revLabel}
        </span>
        <span>
          <i className="dot dot-profit" /> {profitLabel}
        </span>
      </div>
      <div className="chart">
        {points.map((p) => (
          <div
            className="chart-col"
            key={p.label}
            title={`${p.label} · ${revLabel}: ${fmt(p.revenue)} · ${profitLabel}: ${fmt(p.profit)}`}
          >
            <div className="chart-bars">
              <div
                className="bar-col"
                style={{ height: `${Math.max(4, (p.revenue / max) * 100)}%` }}
              >
                {showValues && p.revenue !== 0 && (
                  <span className="bar-val">{fmt(p.revenue)}</span>
                )}
                <div className="bar bar-rev" />
              </div>
              <div
                className="bar-col"
                style={{ height: `${Math.max(4, (Math.abs(p.profit) / max) * 100)}%` }}
              >
                {showValues && p.profit !== 0 && (
                  <span className="bar-val">{fmt(p.profit)}</span>
                )}
                <div className={`bar ${p.profit < 0 ? 'bar-neg' : 'bar-profit'}`} />
              </div>
            </div>
            {showLabels && <div className="chart-label">{p.label}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// The most recent Saturday (start of the Afghan work week) as YYYY-MM-DD.
function weekStartStr(): string {
  const d = new Date();
  const diff = (d.getDay() + 1) % 7; // Sat→0, Sun→1, Mon→2, … Fri→6
  d.setDate(d.getDate() - diff);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type ReportTab = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'range' | 'stock';

interface DayCloseMismatch {
  medicine_name: string;
  batch_no: string;
  on_hand: number;
  ledger_qty: number;
}

interface DayCloseInfo {
  closed: boolean;
  close: {
    closed_at: string;
    expected_cash: number;
    counted_cash: number;
    difference: number;
    note: string | null;
    closed_by_name: string | null;
  } | null;
  cash: {
    till: number;
    customerPayments: number;
    refunds: number;
    supplierPaid: number;
    expected: number;
  };
  stock: {
    sales: { sold: number; returned: number; ledgerNet: number; ok: boolean };
    ledger: { ok: boolean; mismatches: DayCloseMismatch[] };
    movements: {
      purchased: number;
      sold: number;
      saleReturned: number;
      purchaseReturned: number;
      writtenOff: number;
    };
  };
}

// Day Close — the end-of-day panel on the Daily report tab: the cash
// reconciliation (what the drawer should hold), the stock check (ledger
// vs documents), and the lock itself. Closing is two-step; reopening is
// admin only (the server enforces it too).
function DayClosePanel({ lang, date, role }: { lang: Lang; date: string; role: string }) {
  const [info, setInfo] = useState<DayCloseInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [closeArm, setCloseArm] = useState(false);
  const [reopenArm, setReopenArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setLoadError('');
    setCounted('');
    setNote('');
    setCloseArm(false);
    setReopenArm(false);
    setMessage('');
    setError('');
    api
      .get(`/reports/day-close?date=${date}`)
      .then((data) => {
        if (alive) setInfo(data as DayCloseInfo);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'Error');
      });
    return () => {
      alive = false;
    };
  }, [date]);

  const reload = async () => {
    const data = await api.get(`/reports/day-close?date=${date}`);
    setInfo(data as DayCloseInfo);
  };

  const doClose = async () => {
    if (!closeArm) {
      setCloseArm(true);
      return;
    }
    const countedNum = Number(counted);
    if (counted.trim() === '' || !Number.isFinite(countedNum) || countedNum < 0) {
      setError(t(lang, 'dayCloseCountedRequired'));
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post('/reports/day-close', {
        date,
        counted_cash: countedNum,
        note: note.trim() || undefined,
      });
      setMessage(t(lang, 'dayCloseDone'));
      setCloseArm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
      setCloseArm(false);
    }
    setBusy(false);
  };

  const doReopen = async () => {
    if (!reopenArm) {
      setReopenArm(true);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post('/reports/day-close/reopen', { date });
      setMessage(t(lang, 'dayCloseReopened'));
      setReopenArm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
      setReopenArm(false);
    }
    setBusy(false);
  };

  const countedNum = counted.trim() === '' ? null : Number(counted);
  const diff =
    info && countedNum !== null && Number.isFinite(countedNum)
      ? Math.round((countedNum - info.cash.expected) * 100) / 100
      : null;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3 style={{ marginTop: 0 }}>🔒 {t(lang, 'dayClose')} — {date}</h3>
        {info &&
          (info.closed ? (
            <span className="badge warning">🔒 {t(lang, 'dayCloseClosed')}</span>
          ) : (
            <span className="badge ok">{t(lang, 'dayCloseOpen')}</span>
          ))}
      </div>
      <p className="muted">{t(lang, 'dayCloseDesc')}</p>
      {loadError && <div className="error-box">{loadError}</div>}
      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}
      {!info && !loadError && <p className="muted">{t(lang, 'loading')}</p>}
      {info && (
        <>
          <table>
            <tbody>
              <tr>
                <td>{t(lang, 'dayCloseTill')}</td>
                <td style={{ textAlign: 'end' }}>{fmt(info.cash.till)}</td>
              </tr>
              <tr>
                <td>+ {t(lang, 'dayClosePayments')}</td>
                <td style={{ textAlign: 'end' }}>{fmt(info.cash.customerPayments)}</td>
              </tr>
              <tr>
                <td>− {t(lang, 'dayCloseRefunds')}</td>
                <td style={{ textAlign: 'end' }}>{fmt(info.cash.refunds)}</td>
              </tr>
              <tr>
                <td>− {t(lang, 'dayCloseSupplierPaid')}</td>
                <td style={{ textAlign: 'end' }}>{fmt(info.cash.supplierPaid)}</td>
              </tr>
              <tr>
                <td>
                  <strong>{t(lang, 'dayCloseExpected')}</strong>
                </td>
                <td style={{ textAlign: 'end' }}>
                  <strong>{fmt(info.cash.expected)}</strong>
                </td>
              </tr>
            </tbody>
          </table>

          <h4 style={{ marginBottom: 6 }}>📦 {t(lang, 'dayCloseStockTitle')}</h4>
          <p style={{ margin: '4px 0' }}>
            {info.stock.sales.ok ? '✅' : '⚠️'}{' '}
            {t(lang, info.stock.sales.ok ? 'dayCloseSalesOk' : 'dayCloseSalesBad')}{' '}
            <span className="muted">
              ({t(lang, 'dayCloseSoldUnits')} {fmt(info.stock.sales.sold)} −{' '}
              {t(lang, 'dayCloseReturnedUnits')} {fmt(info.stock.sales.returned)} ={' '}
              {fmt(info.stock.sales.ledgerNet)})
            </span>
          </p>
          <p style={{ margin: '4px 0' }}>
            {info.stock.ledger.ok ? '✅' : '⚠️'}{' '}
            {t(lang, info.stock.ledger.ok ? 'dayCloseLedgerOk' : 'dayCloseLedgerBad')}
            {!info.stock.ledger.ok && (
              <span className="muted">
                {' '}
                ({info.stock.ledger.mismatches.length} {t(lang, 'dayCloseBatchesDiffer')})
              </span>
            )}
          </p>
          {!info.stock.ledger.ok && info.stock.ledger.mismatches.length > 0 && (
            <ul className="muted" style={{ margin: '4px 0' }}>
              {info.stock.ledger.mismatches.map((m) => (
                <li key={`${m.medicine_name}-${m.batch_no}`}>
                  {m.medicine_name} ({m.batch_no}): {fmt(m.on_hand)} ≠ {fmt(m.ledger_qty)}
                </li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ margin: '4px 0' }}>
            {t(lang, 'dayClosePurchased')}: {fmt(info.stock.movements.purchased)} ·{' '}
            {t(lang, 'dayCloseSoldUnits')}: {fmt(info.stock.movements.sold)} ·{' '}
            {t(lang, 'dayCloseReturnedUnits')}: {fmt(info.stock.movements.saleReturned)} ·{' '}
            {t(lang, 'dayClosePurchaseReturned')}: {fmt(info.stock.movements.purchaseReturned)} ·{' '}
            {t(lang, 'dayCloseWrittenOff')}: {fmt(info.stock.movements.writtenOff)}
          </p>

          {info.closed && info.close ? (
            <>
              <table>
                <tbody>
                  <tr>
                    <td>{t(lang, 'dayCloseClosedBy')}</td>
                    <td style={{ textAlign: 'end' }}>
                      {info.close.closed_by_name || '—'} ·{' '}
                      {new Date(info.close.closed_at).toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td>{t(lang, 'dayCloseCounted')}</td>
                    <td style={{ textAlign: 'end' }}>{fmt(info.close.counted_cash)}</td>
                  </tr>
                  <tr>
                    <td>{t(lang, 'dayCloseDifference')}</td>
                    <td
                      style={{
                        textAlign: 'end',
                        color: info.close.difference !== 0 ? '#dc2626' : undefined,
                      }}
                    >
                      {fmt(info.close.difference)}
                    </td>
                  </tr>
                </tbody>
              </table>
              {info.close.note && <p>📝 {info.close.note}</p>}
              {role === 'admin' && (
                <button
                  className={reopenArm ? 'btn-danger armed' : 'btn-danger'}
                  onClick={doReopen}
                  disabled={busy}
                >
                  {reopenArm ? t(lang, 'dayCloseReopenConfirm') : `🔓 ${t(lang, 'dayCloseReopen')}`}
                </button>
              )}
            </>
          ) : (
            <div
              style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginTop: 12 }}
            >
              <div className="field">
                <label>{t(lang, 'dayCloseCounted')}</label>
                <input
                  className="cell-input"
                  type="number"
                  min="0"
                  step="any"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                />
              </div>
              <div className="field">
                <label>{t(lang, 'dayCloseNote')}</label>
                <input
                  className="cell-input"
                  value={note}
                  placeholder={t(lang, 'dayCloseNotePh')}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              {diff !== null && (
                <div style={{ paddingBottom: 8 }}>
                  <span className="muted">{t(lang, 'dayCloseDifference')}: </span>
                  <strong style={{ color: diff !== 0 ? '#dc2626' : '#15803d' }}>{fmt(diff)}</strong>
                </div>
              )}
              <button className="btn-save" onClick={doClose} disabled={busy}>
                {closeArm ? t(lang, 'dayCloseConfirm') : `🔒 ${t(lang, 'dayCloseButton')}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReportsPage({ lang, role }: { lang: Lang; role: string }) {
  const now = new Date();
  const [tab, setTab] = useState<ReportTab>('daily');
  const [date, setDate] = useState(todayStr());
  const [weekStart, setWeekStart] = useState(weekStartStr());
  const [rangeFrom, setRangeFrom] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  );
  const [rangeTo, setRangeTo] = useState(todayStr());
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [prevSummary, setPrevSummary] = useState<Summary | null>(null);
  const [prevLabel, setPrevLabel] = useState('');
  const [daySales, setDaySales] = useState<SaleRow[]>([]);
  const [days, setDays] = useState<DayRow[]>([]);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [medRows, setMedRows] = useState<MedRow[]>([]);
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [purchRows, setPurchRows] = useState<PurchRow[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [branch, setBranch] = useState<BranchInfo | null>(null);

  useEffect(() => {
    api
      .get('/settings/branch')
      .then((data) => setBranch(data.branch as BranchInfo))
      .catch(() => undefined);
  }, []);

  // Print the report sheet as soon as it has rendered (same pattern as
  // the receipt): the browser dialog offers both the printer and
  // "Save as PDF", and the browser renders Pashto text correctly.
  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 80);
    return () => clearTimeout(timer);
  }, [printing]);

  const doExport = async () => {
    setError('');
    setExporting(true);
    try {
      if (tab === 'stock') {
        await api.download('/reports/export?period=stock', 'pharmacy-stock-value.xlsx');
      } else if (tab === 'daily') {
        await api.download(`/reports/export?period=daily&date=${date}`, `pharmacy-report-daily-${date}.xlsx`);
      } else if (tab === 'weekly') {
        await api.download(
          `/reports/export?period=weekly&date=${weekStart}`,
          `pharmacy-report-weekly-${weekStart}.xlsx`
        );
      } else if (tab === 'range') {
        await api.download(
          `/reports/export?period=range&from=${rangeFrom}&to=${rangeTo}`,
          `pharmacy-report-range-${rangeFrom}-${rangeTo}.xlsx`
        );
      } else if (tab === 'monthly') {
        await api.download(
          `/reports/export?period=monthly&year=${year}&month=${month}`,
          `pharmacy-report-monthly-${year}-${month}.xlsx`
        );
      } else {
        await api.download(`/reports/export?period=yearly&year=${year}`, `pharmacy-report-yearly-${year}.xlsx`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setExporting(false);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError('');
        if (tab === 'stock') {
          const data = await api.get('/reports/stock-value');
          if (!alive) return;
          setStockData({
            totals: data.totals as StockTotals,
            medicines: data.medicines as StockMedRow[],
          });
          return;
        }
        if (tab === 'daily') {
          const data = await api.get(`/reports/daily?date=${date}`);
          if (!alive) return;
          setSummary(data.summary as Summary);
          setDaySales(data.sales as SaleRow[]);
        } else if (tab === 'weekly') {
          const data = await api.get(`/reports/weekly?date=${weekStart}`);
          if (!alive) return;
          setSummary(data.summary as Summary);
          setDays(data.days as DayRow[]);
        } else if (tab === 'monthly') {
          const data = await api.get(`/reports/monthly?year=${year}&month=${month}`);
          if (!alive) return;
          setSummary(data.summary as Summary);
          setPrevSummary(data.previous as Summary);
          setPrevLabel(String(data.previousLabel || ''));
          setDays(data.days as DayRow[]);
        } else if (tab === 'range') {
          const data = await api.get(`/reports/range?from=${rangeFrom}&to=${rangeTo}`);
          if (!alive) return;
          setSummary(data.summary as Summary);
          setDays(data.days as DayRow[]);
        } else {
          const data = await api.get(`/reports/yearly?year=${year}`);
          if (!alive) return;
          setSummary(data.summary as Summary);
          setMonths(data.months as MonthRow[]);
        }
        const medParams =
          tab === 'daily'
            ? `period=daily&date=${date}`
            : tab === 'weekly'
              ? `period=weekly&date=${weekStart}`
              : tab === 'monthly'
                ? `period=monthly&year=${year}&month=${month}`
                : tab === 'range'
                  ? `period=range&from=${rangeFrom}&to=${rangeTo}`
                  : `period=yearly&year=${year}`;
        const medData = await api.get(`/reports/medicines?${medParams}`);
        if (!alive) return;
        setMedRows(medData.medicines as MedRow[]);
        const purchData = await api.get(`/reports/purchases?${medParams}`);
        if (!alive) return;
        setPurchRows(purchData.suppliers as PurchRow[]);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, date, weekStart, year, month, rangeFrom, rangeTo]);

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'daily', label: t(lang, 'daily') },
    { key: 'weekly', label: t(lang, 'weekly') },
    { key: 'monthly', label: t(lang, 'monthly') },
    { key: 'yearly', label: t(lang, 'yearly') },
    { key: 'range', label: t(lang, 'range') },
    { key: 'stock', label: t(lang, 'stockValue') },
  ];

  // The Afghan work week is 6 days: Saturday–Thursday, Friday off.
  const weekEnd = (() => {
    const d = new Date(`${weekStart}T00:00:00`);
    if (Number.isNaN(d.getTime())) return weekStart;
    d.setDate(d.getDate() + 5);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const periodTitle =
    tab === 'daily'
      ? `${t(lang, 'daily')} — ${date}`
      : tab === 'weekly'
        ? `${t(lang, 'weekly')} — ${weekStart} → ${weekEnd}`
        : tab === 'monthly'
          ? `${t(lang, 'monthly')} — ${year}-${String(month).padStart(2, '0')}`
          : tab === 'range'
            ? `${t(lang, 'range')} — ${rangeFrom} → ${rangeTo}`
            : `${t(lang, 'yearly')} — ${year}`;

  const negStyle = (v: number | string) =>
    Number(v) < 0 ? { color: '#dc2626' } : undefined;

  // Month-over-month change: signed difference plus percent, green when
  // up, red when down. No percent when last month was zero.
  const changeCell = (cur: number, prev: number) => {
    const diff = Math.round((cur - prev) * 100) / 100;
    const pct = prev !== 0 ? Math.round((diff / prev) * 1000) / 10 : null;
    const color = diff > 0 ? '#15803d' : diff < 0 ? '#dc2626' : undefined;
    const sign = diff > 0 ? '+' : '';
    return (
      <span style={{ color }}>
        {sign}
        {fmt(diff)}
        {pct !== null ? ` (${sign}${pct}%)` : ''}
      </span>
    );
  };

  return (
    <>
      <div className="dash-head">
        <h2>{t(lang, 'reports')}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={doExport} disabled={exporting}>
            📊 {exporting ? t(lang, 'loading') : t(lang, 'exportExcel')}
          </button>
          <button
            className="btn"
            onClick={() => setPrinting(true)}
            disabled={tab === 'stock' ? !stockData : !summary}
          >
            🖨️ {t(lang, 'printPdf')}
          </button>
        </div>
      </div>
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
        {tab === 'weekly' && (
          <div className="field">
            <label>{t(lang, 'fromDate')}</label>
            <input
              className="cell-input"
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
            />
          </div>
        )}
        {tab === 'range' && (
          <>
            <div className="field">
              <label>{t(lang, 'fromDate')}</label>
              <input
                className="cell-input"
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
              />
            </div>
            <div className="field">
              <label>{t(lang, 'toDate')}</label>
              <input
                className="cell-input"
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
              />
            </div>
          </>
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
      {tab !== 'stock' && summary && (
        <div className="cards dash-cards">
          <div className="card dash-card accent-green">
            <div className="card-top">
              <span className="card-icon">💰</span>
              <span className="card-label">{t(lang, 'revenue')}</span>
            </div>
            <div className="card-value">{fmt(summary.revenue)}</div>
            <div className="card-sub">{t(lang, 'currency')}</div>
          </div>
          <div className="card dash-card accent-teal">
            <div className="card-top">
              <span className="card-icon">📈</span>
              <span className="card-label">{t(lang, 'profit')}</span>
            </div>
            <div className="card-value" style={negStyle(summary.profit)}>
              {fmt(summary.profit)}
            </div>
            <div className="card-sub">
              {t(lang, 'cost')}: {fmt(summary.cost_total)} · {t(lang, 'profitMargin')}:{' '}
              {summary.revenue !== 0
                ? Math.round((summary.profit / summary.revenue) * 1000) / 10
                : 0}
              %
            </div>
          </div>
          <div className="card dash-card accent-blue">
            <div className="card-top">
              <span className="card-icon">🧾</span>
              <span className="card-label">{t(lang, 'salesCount')}</span>
            </div>
            <div className="card-value">{fmt(summary.sales_count)}</div>
            <div className="card-sub">
              {t(lang, 'itemsSold')}: {fmt(summary.items_sold)}
            </div>
          </div>
          {Number(summary.returns_total || 0) > 0 && (
            <div className="card dash-card accent-amber">
              <div className="card-top">
                <span className="card-icon">↩️</span>
                <span className="card-label">{t(lang, 'returnsLabel')}</span>
              </div>
              <div className="card-value">{fmt(summary.returns_total || 0)}</div>
              <div className="card-sub">{t(lang, 'currency')}</div>
            </div>
          )}
        </div>
      )}

      {tab === 'stock' && stockData && (
        <>
          <div className="cards dash-cards">
            <div className="card dash-card accent-blue">
              <div className="card-top">
                <span className="card-icon">🏷️</span>
                <span className="card-label">{t(lang, 'totalStockValue')}</span>
              </div>
              <div className="card-value">{fmt(stockData.totals.cost_total)}</div>
              <div className="card-sub">{t(lang, 'currency')}</div>
            </div>
            <div className="card dash-card accent-green">
              <div className="card-top">
                <span className="card-icon">💰</span>
                <span className="card-label">{t(lang, 'saleValue')}</span>
              </div>
              <div className="card-value">{fmt(stockData.totals.sale_value)}</div>
              <div className="card-sub">
                {t(lang, 'expectedProfit')}: {fmt(stockData.totals.expected_profit)}
              </div>
            </div>
            <div className="card dash-card accent-amber">
              <div className="card-top">
                <span className="card-icon">⚠️</span>
                <span className="card-label">{t(lang, 'expiringValue')}</span>
              </div>
              <div className="card-value">{fmt(stockData.totals.cost_expiring)}</div>
              <div className="card-sub">{t(lang, 'currency')}</div>
            </div>
            <div className="card dash-card accent-red">
              <div className="card-top">
                <span className="card-icon">⛔</span>
                <span className="card-label">{t(lang, 'expiredValue')}</span>
              </div>
              <div className="card-value">{fmt(stockData.totals.cost_expired)}</div>
              <div className="card-sub">{t(lang, 'currency')}</div>
            </div>
          </div>
          <div className="panel">
            <div className="table-scroll rows-6" style={{ maxHeight: 268, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>{t(lang, 'medicine')}</th>
                  <th>{t(lang, 'qty')}</th>
                  <th>{t(lang, 'totalStockValue')}</th>
                  <th>{t(lang, 'saleValue')}</th>
                  <th>{t(lang, 'expectedProfit')}</th>
                </tr>
              </thead>
              <tbody>
                {stockData.medicines.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{fmt(m.quantity)}</td>
                    <td>{fmt(m.cost_total)}</td>
                    <td>{fmt(m.sale_value)}</td>
                    <td style={negStyle(m.expected_profit)}>{fmt(m.expected_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {tab === 'daily' && <DayClosePanel lang={lang} date={date} role={role} />}

      {tab === 'daily' && summary && (
        <div className="panel">
          <div className="panel-head">
            <h3 style={{ marginTop: 0 }}>🧾 {t(lang, 'recentBills')}</h3>
            <span className="count-badge neutral">{daySales.length}</span>
          </div>
          <div className="table-scroll rows-6" style={{ maxHeight: 268, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 10 }}>
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'invoice')}</th>
                <th>{t(lang, 'customer')}</th>
                <th>{t(lang, 'seller')}</th>
                <th>{t(lang, 'lineTotal')}</th>
                <th>{t(lang, 'returnsLabel')}</th>
                <th>{t(lang, 'netCol')}</th>
              </tr>
            </thead>
            <tbody>
              {daySales.map((s) => {
                const refunded = Number(s.refunded_total || 0);
                return (
                  <tr key={s.id}>
                    <td>
                      {s.invoice_no}
                      <span className="muted"> · {String(s.sale_date).slice(11, 16)}</span>
                    </td>
                    <td>{s.customer_name || t(lang, 'walkIn')}</td>
                    <td>{s.seller_name || '—'}</td>
                    <td>{fmt(Number(s.net_total))}</td>
                    <td>{refunded > 0 ? fmt(refunded) : '—'}</td>
                    <td>{fmt(Number(s.net_total) - refunded)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab === 'monthly' && summary && prevSummary && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            📊 {t(lang, 'prevMonthTitle')} — {prevLabel}
          </h3>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>{t(lang, 'thisMonth')}</th>
                <th>{t(lang, 'prevMonth')}</th>
                <th>{t(lang, 'changeCol')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t(lang, 'revenue')}</td>
                <td>{fmt(summary.revenue)}</td>
                <td>{fmt(prevSummary.revenue)}</td>
                <td>{changeCell(summary.revenue, prevSummary.revenue)}</td>
              </tr>
              <tr>
                <td>{t(lang, 'profit')}</td>
                <td style={negStyle(summary.profit)}>{fmt(summary.profit)}</td>
                <td style={negStyle(prevSummary.profit)}>{fmt(prevSummary.profit)}</td>
                <td>{changeCell(summary.profit, prevSummary.profit)}</td>
              </tr>
              <tr>
                <td>{t(lang, 'salesCount')}</td>
                <td>{fmt(summary.sales_count)}</td>
                <td>{fmt(prevSummary.sales_count)}</td>
                <td>{changeCell(summary.sales_count, prevSummary.sales_count)}</td>
              </tr>
              <tr>
                <td>{t(lang, 'itemsSold')}</td>
                <td>{fmt(summary.items_sold)}</td>
                <td>{fmt(prevSummary.items_sold)}</td>
                <td>{changeCell(summary.items_sold, prevSummary.items_sold)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {(tab === 'monthly' || tab === 'weekly' || tab === 'range') && summary && (
        <div className="panel">
          {days.length > 0 && (
            <BarChart
              points={days.map((d) => ({
                label: String(d.day).slice(5),
                revenue: d.revenue,
                profit: d.profit,
              }))}
              revLabel={t(lang, 'revenue')}
              profitLabel={t(lang, 'profit')}
            />
          )}
          <div className="table-scroll rows-6" style={{ maxHeight: 268, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 10 }}>
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
                  <td style={negStyle(d.profit)}>{fmt(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab === 'yearly' && summary && (
        <div className="panel">
          {months.length > 0 && (
            <BarChart
              points={months.map((m) => ({
                label: `${year}-${String(m.month).padStart(2, '0')}`,
                revenue: m.revenue,
                profit: m.profit,
              }))}
              revLabel={t(lang, 'revenue')}
              profitLabel={t(lang, 'profit')}
            />
          )}
          <div className="table-scroll rows-6" style={{ maxHeight: 268, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 10 }}>
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
                  <td style={negStyle(m.profit)}>{fmt(m.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab !== 'stock' && summary && medRows.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            {t(lang, 'topMedicines')} <span className="count-badge neutral">{medRows.length}</span>
          </h3>
          <div className="table-scroll rows-6" style={{ maxHeight: 268, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 10 }}>
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'medicine')}</th>
                <th>{t(lang, 'qty')}</th>
                <th>{t(lang, 'revenue')}</th>
                <th>{t(lang, 'cost')}</th>
                <th>{t(lang, 'profit')}</th>
              </tr>
            </thead>
            <tbody>
              {medRows.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{fmt(m.quantity)}</td>
                  <td>{fmt(m.revenue)}</td>
                  <td>{fmt(m.cost_total)}</td>
                  <td style={negStyle(m.profit)}>{fmt(m.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab !== 'stock' && summary && purchRows.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            {t(lang, 'purchasesInPeriod')}{' '}
            <span className="count-badge neutral">{purchRows.length}</span>
          </h3>
          <div className="table-scroll rows-6" style={{ maxHeight: 268, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 10 }}>
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'supplier')}</th>
                <th>{t(lang, 'salesCount')}</th>
                <th>{t(lang, 'bought')}</th>
                <th>{t(lang, 'returnsLabel')}</th>
                <th>{t(lang, 'netBought')}</th>
                <th>{t(lang, 'paidCol')}</th>
              </tr>
            </thead>
            <tbody>
              {purchRows.map((r) => (
                <tr key={r.id || 'none'}>
                  <td>{r.name}</td>
                  <td>{fmt(r.bills)}</td>
                  <td>{fmt(r.bought)}</td>
                  <td>{fmt(r.returned)}</td>
                  <td>{fmt(r.net)}</td>
                  <td>{fmt(r.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {printing &&
        tab !== 'stock' &&
        summary &&
        createPortal(
          <div id="report-print" dir={lang === 'en' ? 'ltr' : 'rtl'}>
            <div className="print-head">
              <div className="print-brand">{branch?.name || 'Pharmacy'}</div>
              {branch?.address && <div>{branch.address}</div>}
              {branch?.phone && <div>{branch.phone}</div>}
              <div className="print-title">
                {t(lang, 'reports')} — {periodTitle}
              </div>
            </div>
            <table className="print-summary">
              <tbody>
                <tr>
                  <td>{t(lang, 'revenue')}</td>
                  <td>
                    {fmt(summary.revenue)} {t(lang, 'currency')}
                  </td>
                </tr>
                <tr>
                  <td>{t(lang, 'cost')}</td>
                  <td>
                    {fmt(summary.cost_total)} {t(lang, 'currency')}
                  </td>
                </tr>
                <tr className="profit-row">
                  <td>{t(lang, 'profit')}</td>
                  <td>
                    {fmt(summary.profit)} {t(lang, 'currency')}
                  </td>
                </tr>
                <tr>
                  <td>{t(lang, 'profitMargin')}</td>
                  <td>
                    {summary.revenue !== 0
                      ? Math.round((summary.profit / summary.revenue) * 1000) / 10
                      : 0}
                    %
                  </td>
                </tr>
                <tr>
                  <td>{t(lang, 'salesCount')}</td>
                  <td>{fmt(summary.sales_count)}</td>
                </tr>
                <tr>
                  <td>{t(lang, 'itemsSold')}</td>
                  <td>{fmt(summary.items_sold)}</td>
                </tr>
                {Number(summary.discount_total) > 0 && (
                  <tr>
                    <td>{t(lang, 'discount')}</td>
                    <td>
                      {fmt(summary.discount_total)} {t(lang, 'currency')}
                    </td>
                  </tr>
                )}
                {Number(summary.returns_total || 0) > 0 && (
                  <tr>
                    <td>{t(lang, 'returnsLabel')}</td>
                    <td>
                      {fmt(summary.returns_total || 0)} {t(lang, 'currency')} (
                      {fmt(summary.returned_items || 0)})
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {tab === 'monthly' && prevSummary && (
              <>
                <div className="print-section">
                  {t(lang, 'prevMonthTitle')} — {prevLabel}
                </div>
                <table className="print-nums">
                  <thead>
                    <tr>
                      <th></th>
                      <th>{t(lang, 'thisMonth')}</th>
                      <th>{t(lang, 'prevMonth')}</th>
                      <th>{t(lang, 'changeCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{t(lang, 'revenue')}</td>
                      <td>{fmt(summary.revenue)}</td>
                      <td>{fmt(prevSummary.revenue)}</td>
                      <td>{changeCell(summary.revenue, prevSummary.revenue)}</td>
                    </tr>
                    <tr>
                      <td>{t(lang, 'profit')}</td>
                      <td>{fmt(summary.profit)}</td>
                      <td>{fmt(prevSummary.profit)}</td>
                      <td>{changeCell(summary.profit, prevSummary.profit)}</td>
                    </tr>
                    <tr>
                      <td>{t(lang, 'salesCount')}</td>
                      <td>{fmt(summary.sales_count)}</td>
                      <td>{fmt(prevSummary.sales_count)}</td>
                      <td>{changeCell(summary.sales_count, prevSummary.sales_count)}</td>
                    </tr>
                    <tr>
                      <td>{t(lang, 'itemsSold')}</td>
                      <td>{fmt(summary.items_sold)}</td>
                      <td>{fmt(prevSummary.items_sold)}</td>
                      <td>{changeCell(summary.items_sold, prevSummary.items_sold)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
            {tab === 'daily' && (
              <table>
                <thead>
                  <tr>
                    <th>{t(lang, 'invoice')}</th>
                    <th>{t(lang, 'customer')}</th>
                    <th>{t(lang, 'seller')}</th>
                    <th className="num">{t(lang, 'lineTotal')}</th>
                    <th className="num">{t(lang, 'returnsLabel')}</th>
                    <th className="num">{t(lang, 'netCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {daySales.map((s) => {
                    const refunded = Number(s.refunded_total || 0);
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.invoice_no} · {String(s.sale_date).slice(11, 16)}
                        </td>
                        <td>{s.customer_name || t(lang, 'walkIn')}</td>
                        <td>{s.seller_name || '—'}</td>
                        <td className="num">{fmt(Number(s.net_total))}</td>
                        <td className="num">{refunded > 0 ? fmt(refunded) : '—'}</td>
                        <td className="num">{fmt(Number(s.net_total) - refunded)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>{t(lang, 'lineTotal')}</td>
                    <td className="num">
                      {fmt(daySales.reduce((sum, s) => sum + Number(s.net_total), 0))}
                    </td>
                    <td className="num">
                      {fmt(daySales.reduce((sum, s) => sum + Number(s.refunded_total || 0), 0))}
                    </td>
                    <td className="num">
                      {fmt(
                        daySales.reduce(
                          (sum, s) => sum + Number(s.net_total) - Number(s.refunded_total || 0),
                          0
                        )
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
            {(tab === 'weekly' || tab === 'monthly' || tab === 'range') && (
              <table className="print-nums">
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
            )}
            {tab === 'yearly' && (
              <table className="print-nums">
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
            )}
            {medRows.length > 0 && (
              <>
                <div className="print-section">{t(lang, 'topMedicines')}</div>
                <table className="print-nums">
                  <thead>
                    <tr>
                      <th>{t(lang, 'medicine')}</th>
                      <th>{t(lang, 'qty')}</th>
                      <th>{t(lang, 'revenue')}</th>
                      <th>{t(lang, 'cost')}</th>
                      <th>{t(lang, 'profit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {medRows.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{fmt(m.quantity)}</td>
                        <td>{fmt(m.revenue)}</td>
                        <td>{fmt(m.cost_total)}</td>
                        <td>{fmt(m.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t(lang, 'lineTotal')}</td>
                      <td>{fmt(medRows.reduce((sum, m) => sum + Number(m.quantity), 0))}</td>
                      <td>{fmt(medRows.reduce((sum, m) => sum + Number(m.revenue), 0))}</td>
                      <td>{fmt(medRows.reduce((sum, m) => sum + Number(m.cost_total), 0))}</td>
                      <td>{fmt(medRows.reduce((sum, m) => sum + Number(m.profit), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
            {purchRows.length > 0 && (
              <>
                <div className="print-section">{t(lang, 'purchasesInPeriod')}</div>
                <table className="print-nums">
                  <thead>
                    <tr>
                      <th>{t(lang, 'supplier')}</th>
                      <th>{t(lang, 'bought')}</th>
                      <th>{t(lang, 'returnsLabel')}</th>
                      <th>{t(lang, 'netBought')}</th>
                      <th>{t(lang, 'paidCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchRows.map((r) => (
                      <tr key={r.id || 'none'}>
                        <td>{r.name}</td>
                        <td>{fmt(r.bought)}</td>
                        <td>{fmt(r.returned)}</td>
                        <td>{fmt(r.net)}</td>
                        <td>{fmt(r.paid)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t(lang, 'lineTotal')}</td>
                      <td>{fmt(purchRows.reduce((sum, r) => sum + Number(r.bought), 0))}</td>
                      <td>{fmt(purchRows.reduce((sum, r) => sum + Number(r.returned), 0))}</td>
                      <td>{fmt(purchRows.reduce((sum, r) => sum + Number(r.net), 0))}</td>
                      <td>{fmt(purchRows.reduce((sum, r) => sum + Number(r.paid), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
            <div className="print-footer">
              {t(lang, 'generatedOn')}: {new Date().toLocaleString()}
            </div>
          </div>,
          document.body
        )}

      {printing &&
        tab === 'stock' &&
        stockData &&
        createPortal(
          <div id="report-print" dir={lang === 'en' ? 'ltr' : 'rtl'}>
            <div className="print-head">
              <div className="print-brand">{branch?.name || 'Pharmacy'}</div>
              {branch?.address && <div>{branch.address}</div>}
              {branch?.phone && <div>{branch.phone}</div>}
              <div className="print-title">
                {t(lang, 'reports')} — {t(lang, 'stockValue')}
              </div>
            </div>
            <table className="print-summary">
              <tbody>
                <tr>
                  <td>{t(lang, 'totalStockValue')}</td>
                  <td>
                    {fmt(stockData.totals.cost_total)} {t(lang, 'currency')}
                  </td>
                </tr>
                <tr>
                  <td>{t(lang, 'saleValue')}</td>
                  <td>
                    {fmt(stockData.totals.sale_value)} {t(lang, 'currency')}
                  </td>
                </tr>
                <tr className="profit-row">
                  <td>{t(lang, 'expectedProfit')}</td>
                  <td>
                    {fmt(stockData.totals.expected_profit)} {t(lang, 'currency')}
                  </td>
                </tr>
                <tr>
                  <td>{t(lang, 'expiringValue')}</td>
                  <td>
                    {fmt(stockData.totals.cost_expiring)} {t(lang, 'currency')}
                  </td>
                </tr>
                <tr>
                  <td>{t(lang, 'expiredValue')}</td>
                  <td>
                    {fmt(stockData.totals.cost_expired)} {t(lang, 'currency')}
                  </td>
                </tr>
              </tbody>
            </table>
            <table className="print-nums">
              <thead>
                <tr>
                  <th>{t(lang, 'medicine')}</th>
                  <th>{t(lang, 'qty')}</th>
                  <th>{t(lang, 'totalStockValue')}</th>
                  <th>{t(lang, 'saleValue')}</th>
                  <th>{t(lang, 'expectedProfit')}</th>
                </tr>
              </thead>
              <tbody>
                {stockData.medicines.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{fmt(m.quantity)}</td>
                    <td>{fmt(m.cost_total)}</td>
                    <td>{fmt(m.sale_value)}</td>
                    <td>{fmt(m.expected_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="print-footer">
              {t(lang, 'generatedOn')}: {new Date().toLocaleString()}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function CustomersPage({ lang, role }: { lang: Lang; role: string }) {
  // A cashier adds and views customers; editing, deleting and collecting
  // credit need a pharmacist or admin (the server enforces this too).
  const canManage = role !== 'cashier';
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
  const [formOpen, setFormOpen] = useState(false);
  const [dueFilter, setDueFilter] = useState<'all' | 'due'>('all');
  const [paySaleId, setPaySaleId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMsg, setPayMsg] = useState('');
  const [payError, setPayError] = useState('');
  const [payBusy, setPayBusy] = useState(false);

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
      (!q ||
        r.name.toLowerCase().includes(q) ||
        (r.phone || '').toLowerCase().includes(q)) &&
      (dueFilter === 'all' ? true : Number(r.due_total || 0) > 0)
  );
  const withDueCount = rows.filter((r) => Number(r.due_total || 0) > 0).length;
  const totalDue = rows.reduce((sum, r) => sum + Number(r.due_total || 0), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!name.trim()) {
      setError(t(lang, 'nameRequired'));
      return;
    }
    if (!validPhone(phone)) {
      setError(t(lang, 'phoneInvalid'));
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
      setFormOpen(false);
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
    if (!validPhone(editPhone)) {
      setError(t(lang, 'phoneInvalid'));
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

  // Collect credit right here: a payment against one of this customer's
  // bills, using the same guarded endpoint as the Sales page (the server
  // rejects anything above what is still due on the bill).
  const submitPayment = async () => {
    if (!history || !paySaleId) return;
    setPayError('');
    setPayMsg('');
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError(t(lang, 'paidAmount'));
      return;
    }
    setPayBusy(true);
    try {
      await api.post(`/sales/${paySaleId}/payment`, { amount });
      setPayMsg(t(lang, 'paymentDone'));
      setPayAmount('');
      setPaySaleId('');
      await load();
      await selectCustomer(history.customer);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Error');
    }
    setPayBusy(false);
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
      <div className="dash-head">
        <h2>
          {t(lang, 'customers')} <span className="count-badge neutral">{rows.length}</span>
        </h2>
        {!formOpen && (
          <button
            className="btn-primary"
            style={{ width: 'auto', marginTop: 0 }}
            onClick={() => {
              setError('');
              setMsg('');
              setFormOpen(true);
            }}
          >
            ➕ {t(lang, 'addCustomer')}
          </button>
        )}
      </div>
      <div className="cards dash-cards">
        <div className="card dash-card accent-blue">
          <div className="card-top">
            <span className="card-icon">👥</span>
            <span className="card-label">{t(lang, 'customers')}</span>
          </div>
          <div className="card-value">{fmt(rows.length)}</div>
        </div>
        <div className="card dash-card accent-amber">
          <div className="card-top">
            <span className="card-icon">⚠️</span>
            <span className="card-label">{t(lang, 'withDue')}</span>
          </div>
          <div className="card-value">{fmt(withDueCount)}</div>
        </div>
        <div className="card dash-card accent-red">
          <div className="card-top">
            <span className="card-icon">💸</span>
            <span className="card-label">{t(lang, 'dueAmount')}</span>
          </div>
          <div className="card-value">{fmt(totalDue)}</div>
          <div className="card-sub">{t(lang, 'currency')}</div>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      {msg && <div className="success-box">{msg}</div>}

      {formOpen && (
      <div className="panel">
        <h3>➕ {t(lang, 'addCustomer')}</h3>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'name')} *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>{t(lang, 'phone')}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={10} inputMode="numeric" />
            </div>
          </div>
          <button className="btn-save" type="submit" disabled={busy}>
            {busy ? t(lang, 'loading') : t(lang, 'save')}
          </button>{' '}
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setFormOpen(false)}
          >
            {t(lang, 'cancel')}
          </button>
        </form>
      </div>
      )}

      <div className="panel">
        <div className="med-toolbar">
          <input
            className="search-input"
            placeholder={t(lang, 'searchCustomer')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={`chip ${dueFilter === 'all' ? 'active' : ''}`}
            onClick={() => setDueFilter('all')}
          >
            {t(lang, 'allFilter')} ({rows.length})
          </button>
          <button
            type="button"
            className={`chip ${dueFilter === 'due' ? 'active' : ''}`}
            onClick={() => setDueFilter('due')}
          >
            {t(lang, 'withDue')} ({withDueCount})
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 15 }}>
            {t(lang, 'noCustomers')}
          </p>
        ) : (
          <div className="table-scroll rows-6" style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 10 }}>
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'name')}</th>
                <th>{t(lang, 'phone')}</th>
                <th>{t(lang, 'dueAmount')}</th>
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
                  <td>
                    {Number(r.due_total || 0) > 0 ? (
                      <span className="badge warning">
                        {t(lang, 'credit')}: {fmt(Number(r.due_total))} {t(lang, 'currency')}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
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
                          maxLength={10}
                          inputMode="numeric"
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
                    ) : canManage ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-secondary" onClick={() => startEdit(r)}>
                          {t(lang, 'edit')}
                        </button>
                        <button className="btn-remove" onClick={() => setDeletingId(r.id)}>
                          {t(lang, 'delete')}
                        </button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>🧾 {t(lang, 'purchaseHistory')}</h3>
          {history && (
            <button
              className="link-btn"
              onClick={() => {
                setHistory(null);
                setSelectedId('');
                setPaySaleId('');
                setPayMsg('');
                setPayError('');
              }}
            >
              ✕ {t(lang, 'closeBtn')}
            </button>
          )}
        </div>
        {!history && !historyLoading && (
          <p className="muted" style={{ fontSize: 15 }}>
            {t(lang, 'selectCustomer')}
          </p>
        )}
        {historyLoading && <p className="muted">{t(lang, 'loading')}</p>}
        {history && (
          <>
            <div className="cards dash-cards">
              <div className="card dash-card accent-blue">
                <div className="card-top">
                  <span className="card-icon">👤</span>
                  <span className="card-label">{t(lang, 'customer')}</span>
                </div>
                <div className="card-value" style={{ fontSize: 20 }}>
                  {history.customer.name}
                </div>
                <div className="card-sub">{history.customer.phone || '—'}</div>
              </div>
              <div className="card dash-card accent-purple">
                <div className="card-top">
                  <span className="card-icon">🧾</span>
                  <span className="card-label">{t(lang, 'billsCount')}</span>
                </div>
                <div className="card-value">{fmt(history.totals.bills)}</div>
              </div>
              <div className="card dash-card accent-green">
                <div className="card-top">
                  <span className="card-icon">💰</span>
                  <span className="card-label">{t(lang, 'totalSpent')}</span>
                </div>
                <div className="card-value">{fmt(history.totals.total_spent)}</div>
                <div className="card-sub">{t(lang, 'currency')}</div>
              </div>
              <div className="card dash-card accent-amber">
                <div className="card-top">
                  <span className="card-icon">💸</span>
                  <span className="card-label">{t(lang, 'dueAmount')}</span>
                </div>
                <div className="card-value">
                  {fmt(
                    history.sales.reduce((sum, s) => sum + Number(s.due_amount || 0), 0)
                  )}
                </div>
                <div className="card-sub">{t(lang, 'currency')}</div>
              </div>
            </div>
            {payError && <div className="error-box">{payError}</div>}
            {payMsg && <div className="success-box">{payMsg}</div>}
            {history.sales.length === 0 ? (
              <p className="muted" style={{ fontSize: 15 }}>
                {t(lang, 'noPurchases')}
              </p>
            ) : (
              <>
                <div className="table-scroll rows-6" style={{ maxHeight: 268, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t(lang, 'invoice')}</th>
                      <th>{t(lang, 'dateLabel')}</th>
                      <th>{t(lang, 'qty')}</th>
                      <th>{t(lang, 'lineTotal')}</th>
                      <th>{t(lang, 'paidTotal')}</th>
                      <th>{t(lang, 'due')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.sales.map((s) => {
                      const due = Number(s.due_amount || 0);
                      return (
                        <tr key={s.id}>
                          <td>
                            {s.invoice_no}
                            {s.voided ? (
                              <span className="badge danger" style={{ marginInlineStart: 6 }}>
                                {t(lang, 'voidedFull')}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            {String(s.sale_date).slice(0, 10)} {String(s.sale_date).slice(11, 16)}
                          </td>
                          <td>{fmt(Number(s.items))}</td>
                          <td>{fmt(Number(s.net_total))}</td>
                          <td>{fmt(Number(s.paid_total || 0))}</td>
                          <td>
                            {due > 0 ? (
                              <span className="badge warning">{fmt(due)}</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {canManage && due > 0 && !s.voided && (
                              <button
                                className="btn-secondary"
                                onClick={() => {
                                  setPaySaleId(s.id);
                                  setPayAmount(String(due));
                                  setPayError('');
                                  setPayMsg('');
                                }}
                              >
                                {t(lang, 'recordPayment')}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                {canManage && paySaleId && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginTop: 12,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {history.sales.find((s) => s.id === paySaleId)?.invoice_no} —{' '}
                      {t(lang, 'due')}: {fmt(Number(history.sales.find((s) => s.id === paySaleId)?.due_amount || 0))}{' '}
                      {t(lang, 'currency')}
                    </span>
                    <input
                      className="cell-input"
                      style={{ width: 140 }}
                      type="number"
                      min="0"
                      step="any"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder={t(lang, 'paidAmount')}
                    />
                    <button className="btn-save" onClick={submitPayment} disabled={payBusy}>
                      {payBusy ? t(lang, 'loading') : t(lang, 'recordPayment')}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setPaySaleId('');
                        setPayError('');
                      }}
                    >
                      {t(lang, 'cancel')}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// Saves a blob letting the user pick the location (any folder, USB drive,
// ...). Chrome/Edge show the native Save dialog; other browsers fall back
// to the normal download into the Downloads folder. Returns how the file
// was saved, or null when the user closed the Save dialog (not an error).
async function saveBlobWithPicker(blob: Blob, name: string): Promise<'picker' | 'fallback' | null> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: Record<string, unknown>) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [
          {
            description: 'SQL backup',
            accept: { 'application/sql': ['.sql'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    } catch (pickErr) {
      // Closing the Save dialog is not an error — just do nothing.
      if ((pickErr as Error).name !== 'AbortError') throw pickErr;
      return null;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'fallback';
}

interface AutoBackupConfig {
  enabled: boolean;
  folder: string;
  keep: number;
  lastRun: string | null;
  lastFile: string | null;
  lastError: string | null;
}

interface AutoBackupFile {
  name: string;
  size: number;
  mtime: string;
}

function BackupPage({
  lang,
  isAdmin,
  onLogout,
}: {
  lang: Lang;
  isAdmin: boolean;
  onLogout: () => void;
}) {
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
      const { blob, name } = await api.downloadBlob('/backup/download', 'pharmacy_db.sql');
      const how = await saveBlobWithPicker(blob, name);
      if (how === 'picker') setDlMsg(t(lang, 'backupDone'));
      else if (how === 'fallback') setDlMsg(`${t(lang, 'backupDone')} — ${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setDlBusy(false);
  };

  const [autoCfg, setAutoCfg] = useState<AutoBackupConfig | null>(null);
  const [autoForm, setAutoForm] = useState({ enabled: true, folder: '', keep: 7 });
  const [autoFiles, setAutoFiles] = useState<AutoBackupFile[]>([]);
  const [autoMsg, setAutoMsg] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);

  const loadAuto = async () => {
    try {
      const cfg = await api.get('/backup/auto/config');
      setAutoCfg(cfg.config as AutoBackupConfig);
      setAutoForm({
        enabled: cfg.config.enabled,
        folder: cfg.config.folder,
        keep: cfg.config.keep,
      });
      const files = await api.get('/backup/auto/files');
      setAutoFiles((files.files || []) as AutoBackupFile[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  useEffect(() => {
    if (isAdmin) loadAuto();
  }, [isAdmin]);

  const saveAuto = async () => {
    setError('');
    setAutoMsg('');
    setAutoBusy(true);
    try {
      const res = await api.put('/backup/auto/config', autoForm);
      setAutoCfg(res.config as AutoBackupConfig);
      setAutoMsg(t(lang, 'autoBackupSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setAutoBusy(false);
  };

  const runAutoNow = async () => {
    setError('');
    setAutoMsg('');
    setAutoBusy(true);
    try {
      await api.post('/backup/auto/run', {});
      setAutoMsg(t(lang, 'autoBackupDone'));
      await loadAuto();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
    setAutoBusy(false);
  };

  const downloadAutoFile = async (fileName: string) => {
    setError('');
    try {
      const { blob, name } = await api.downloadBlob(
        `/backup/auto/files/${encodeURIComponent(fileName)}`,
        fileName
      );
      if (await saveBlobWithPicker(blob, name)) setAutoMsg(t(lang, 'backupDone'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
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

      {isAdmin && (
      <div className="panel">
        <h3>🕐 {t(lang, 'autoBackup')}</h3>
        <p className="muted" style={{ fontSize: 15 }}>
          {t(lang, 'autoBackupDesc')}
        </p>
        {autoCfg && (
          <p className="muted" style={{ fontSize: 15 }}>
            {t(lang, 'autoBackupLast')}:{' '}
            {autoCfg.lastFile
              ? `${autoCfg.lastFile}${autoCfg.lastRun ? ` — ${new Date(autoCfg.lastRun).toLocaleString()}` : ''}`
              : t(lang, 'autoBackupNever')}
          </p>
        )}
        {autoCfg && autoCfg.lastError && (
          <div className="error-box">
            {t(lang, 'autoBackupError')}: {autoCfg.lastError}
          </div>
        )}
        {autoMsg && <div className="success-box">{autoMsg}</div>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
          <input
            type="checkbox"
            checked={autoForm.enabled}
            onChange={(e) => setAutoForm({ ...autoForm, enabled: e.target.checked })}
          />
          {t(lang, 'autoBackupEnabled')}
        </label>
        <div className="field">
          <label>{t(lang, 'autoBackupFolder')}</label>
          <input
            value={autoForm.folder}
            onChange={(e) => setAutoForm({ ...autoForm, folder: e.target.value })}
            dir="ltr"
            style={{ textAlign: 'left' }}
          />
        </div>
        <div className="field">
          <label>{t(lang, 'autoBackupKeep')}</label>
          <input
            type="number"
            min={1}
            max={90}
            value={autoForm.keep}
            onChange={(e) => setAutoForm({ ...autoForm, keep: Number(e.target.value) })}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-save" onClick={saveAuto} disabled={autoBusy}>
            {autoBusy ? t(lang, 'loading') : t(lang, 'save')}
          </button>
          <button className="btn-secondary" onClick={runAutoNow} disabled={autoBusy}>
            {t(lang, 'autoBackupRunNow')}
          </button>
        </div>
        <h4 style={{ margin: '18px 0 6px' }}>{t(lang, 'autoBackupFiles')}</h4>
        {autoFiles.length === 0 ? (
          <p className="muted">{t(lang, 'noAutoBackups')}</p>
        ) : (
          autoFiles.map((f) => (
            <div
              key={f.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <span dir="ltr" style={{ fontSize: 14 }}>
                {f.name} — {fmt(Math.max(1, Math.round(f.size / 1024)))} KB
              </span>
              <button className="btn-secondary" onClick={() => downloadAutoFile(f.name)}>
                ⬇️ {t(lang, 'downloadBackup')}
              </button>
            </div>
          ))
        )}
      </div>
      )}

      {isAdmin && (
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
      )}
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

interface AuditEntry {
  id: string;
  created_at: string;
  action: string;
  table_name: string;
  record_id: string | null;
  details: { summary?: string } | string | null;
  full_name: string | null;
  username: string | null;
}

function auditSummary(details: AuditEntry['details']): string {
  if (!details) return '';
  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details) as { summary?: string };
      return parsed.summary || '';
    } catch {
      return '';
    }
  }
  return details.summary || '';
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
  const [showPw, setShowPw] = useState(false);
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
  const [delUserId, setDelUserId] = useState('');
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetPw2, setResetPw2] = useState('');
  const [resetShowPw, setResetShowPw] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditActions, setAuditActions] = useState<string[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditUser, setAuditUser] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState('');

  const loadAudit = async (offset: number, append: boolean) => {
    setAuditBusy(true);
    setAuditError('');
    try {
      const q = new URLSearchParams({ limit: '100', offset: String(offset) });
      if (auditUser) q.set('user_id', auditUser);
      if (auditAction) q.set('action', auditAction);
      if (auditFrom) q.set('from', auditFrom);
      if (auditTo) q.set('to', auditTo);
      const data = await api.get(`/settings/audit-log?${q.toString()}`);
      setAuditActions((data.actions || []) as string[]);
      setAuditTotal(data.total as number);
      const entries = (data.entries || []) as AuditEntry[];
      setAuditEntries((prev) => (append ? [...prev, ...entries] : entries));
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Error');
    }
    setAuditBusy(false);
  };

  useEffect(() => {
    if (isAdmin) loadAudit(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, auditUser, auditAction, auditFrom, auditTo]);

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
    if (branch.phone && !validPhone(branch.phone)) {
      setBrError(t(lang, 'phoneInvalid'));
      return;
    }
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

  const deleteUser = async (u: ManagedUser) => {
    setUsMsg('');
    setUsError('');
    try {
      await api.del(`/settings/users/${u.id}`);
      setUsMsg(t(lang, 'userDeleted'));
      setDelUserId('');
      if (resetUser?.id === u.id) setResetUser(null);
      await loadUsers();
    } catch (err) {
      setUsError(err instanceof Error ? err.message : 'Error');
    }
  };

  const submitResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUser) return;
    setUsMsg('');
    setUsError('');
    if (resetPw.length < 6) {
      setUsError(t(lang, 'passwordTooShort'));
      return;
    }
    if (resetPw !== resetPw2) {
      setUsError(t(lang, 'passwordMismatch'));
      return;
    }
    setResetBusy(true);
    try {
      await api.post(`/settings/users/${resetUser.id}/reset-password`, {
        password: resetPw,
      });
      setUsMsg(t(lang, 'passwordResetDone'));
      setResetUser(null);
      setResetPw('');
      setResetPw2('');
    } catch (err) {
      setUsError(err instanceof Error ? err.message : 'Error');
    }
    setResetBusy(false);
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
              <input type={showPw ? 'text' : 'password'} value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
            </div>
            <div className="field">
              <label>{t(lang, 'newPassword')}</label>
              <input type={showPw ? 'text' : 'password'} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
            </div>
            <div className="field">
              <label>{t(lang, 'confirmPassword')}</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
              />
            </div>
          </div>
          <label className="show-pw">
            <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />{' '}
            {t(lang, 'showPassword')}
          </label>
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
                  maxLength={10}
                  inputMode="numeric"
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
          <p className="muted" style={{ fontSize: 14, marginTop: -6 }}>
            {t(lang, 'passwordResetNote')}
          </p>
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
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn-secondary" onClick={() => toggleActive(u)}>
                          {u.is_active ? t(lang, 'deactivate') : t(lang, 'activate')}
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setUsMsg('');
                            setUsError('');
                            setResetUser(u);
                            setResetPw('');
                            setResetPw2('');
                          }}
                        >
                          🔑 {t(lang, 'resetPassword')}
                        </button>
                        {delUserId === u.id ? (
                          <>
                            <span style={{ fontSize: 13, alignSelf: 'center' }}>
                              {t(lang, 'confirmDeleteIt')}
                            </span>
                            <button className="btn-remove" onClick={() => deleteUser(u)}>
                              {t(lang, 'delete')}
                            </button>
                            <button className="btn-secondary" onClick={() => setDelUserId('')}>
                              {t(lang, 'cancel')}
                            </button>
                          </>
                        ) : (
                          <button className="btn-remove" onClick={() => setDelUserId(u.id)}>
                            {t(lang, 'delete')}
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {resetUser && (
            <form onSubmit={submitResetPassword} style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>
                🔑 {t(lang, 'resetPassword')} — {resetUser.full_name} ({resetUser.username})
              </h3>
              <div className="form-grid">
                <div className="field">
                  <label>{t(lang, 'newPassword')} *</label>
                  <input
                    type={resetShowPw ? 'text' : 'password'}
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>{t(lang, 'confirmPassword')} *</label>
                  <input
                    type={resetShowPw ? 'text' : 'password'}
                    value={resetPw2}
                    onChange={(e) => setResetPw2(e.target.value)}
                    required
                  />
                </div>
              </div>
              <label className="show-pw">
                <input
                  type="checkbox"
                  checked={resetShowPw}
                  onChange={(e) => setResetShowPw(e.target.checked)}
                />{' '}
                {t(lang, 'showPassword')}
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-save" type="submit" disabled={resetBusy}>
                  {resetBusy ? t(lang, 'loading') : t(lang, 'resetPassword')}
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setResetUser(null)}
                >
                  {t(lang, 'cancel')}
                </button>
              </div>
            </form>
          )}

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
                  type={showPw ? 'text' : 'password'}
                  value={nuPassword}
                  onChange={(e) => setNuPassword(e.target.value)}
                  required
                />
                <label className="show-pw">
                  <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />{' '}
                  {t(lang, 'showPassword')}
                </label>
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

      {isAdmin && (
        <div className="panel">
          <h3>📜 {t(lang, 'auditLog')}</h3>
          <p className="muted" style={{ fontSize: 15 }}>
            {t(lang, 'auditLogDesc')}
          </p>
          <div className="form-grid">
            <div className="field">
              <label>{t(lang, 'auditUser')}</label>
              <select
                className="field-select"
                value={auditUser}
                onChange={(e) => setAuditUser(e.target.value)}
              >
                <option value="">{t(lang, 'allFilter')}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({u.username})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t(lang, 'auditAction')}</label>
              <select
                className="field-select"
                value={auditAction}
                onChange={(e) => setAuditAction(e.target.value)}
              >
                <option value="">{t(lang, 'allFilter')}</option>
                {auditActions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t(lang, 'fromDate')}</label>
              <input type="date" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>{t(lang, 'toDate')}</label>
              <input type="date" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} />
            </div>
          </div>
          {auditError && <div className="error-box">{auditError}</div>}
          {auditEntries.length === 0 ? (
            <p className="muted">{auditBusy ? t(lang, 'loading') : t(lang, 'noAuditEntries')}</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t(lang, 'auditTime')}</th>
                    <th>{t(lang, 'auditUser')}</th>
                    <th>{t(lang, 'auditAction')}</th>
                    <th>{t(lang, 'auditDetails')}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(e.created_at).toLocaleString()}
                      </td>
                      <td>{e.full_name || e.username || '—'}</td>
                      <td dir="ltr" style={{ textAlign: 'left' }}>{e.action}</td>
                      <td>{auditSummary(e.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {auditEntries.length > 0 && auditEntries.length < auditTotal && (
            <button
              className="btn-secondary"
              style={{ marginTop: 10 }}
              onClick={() => loadAudit(auditEntries.length, true)}
              disabled={auditBusy}
            >
              {auditBusy ? t(lang, 'loading') : t(lang, 'auditMore')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
