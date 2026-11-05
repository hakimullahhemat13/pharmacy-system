// Interface texts in the three system languages: Pashto (ps, default),
// Dari (fa) and English (en). Pashto and Dari are RTL, English is LTR.
export type Lang = 'ps' | 'fa' | 'en';

export const LANG_NAMES: Record<Lang, string> = {
  ps: 'پښتو',
  fa: 'دری',
  en: 'English',
};

export function dirFor(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'en' ? 'ltr' : 'rtl';
}

type Dict = Record<string, string>;

const ps: Dict = {
  appName: 'د درملتون مدیریت سیستم',
  login: 'ننوتل',
  username: 'کارن نوم',
  password: 'پاسورډ',
  loginFailed: 'کارن نوم یا پاسورډ سم نه دی',
  serverDown: 'له سرور سره اړیکه و نه شوه — وګوره چې سرور روان دی',
  dashboard: 'ډشبورډ',
  medicines: 'درمل',
  sales: 'پلور',
  purchases: 'پېرود',
  reports: 'راپورونه',
  comingSoon: 'دا پاڼه په راتلونکي ګام کې جوړېږي',
  logout: 'وتل',
  todayRevenue: 'د نن پلور',
  todayProfit: 'د نن ګټه',
  todayBills: 'د نن بیلونه',
  itemsSold: 'پلورل شوي توکي',
  expiryWarnings: 'د ختمېدو خبرتیاوې',
  noWarnings: 'تر راتلونکو ۳ میاشتو پورې هېڅ بېچ نه ختمېږي 🎉',
  medicine: 'درمل',
  batch: 'بېچ',
  expiryDate: 'د ختمېدو نېټه',
  daysLeft: 'پاتې ورځې',
  qty: 'مقدار',
  levelExpired: 'ختم شوی',
  levelCritical: 'ډېر نږدې',
  levelWarning: 'خبرداری',
  stockSummary: 'سټاک',
  totalMedicines: 'ټول درمل',
  lowStock: 'کم سټاک',
  currency: 'افغانۍ',
  loading: 'لږ صبر…',
};

const fa: Dict = {
  appName: 'سیستم مدیریت دواخانه',
  login: 'ورود',
  username: 'نام کاربر',
  password: 'رمز عبور',
  loginFailed: 'نام کاربر یا رمز عبور درست نیست',
  serverDown: 'ارتباط با سرور برقرار نشد — ببینید که سرور روشن است',
  dashboard: 'داشبورد',
  medicines: 'ادویه',
  sales: 'فروش',
  purchases: 'خریداری',
  reports: 'راپورها',
  comingSoon: 'این صفحه در گام بعدی ساخته می‌شود',
  logout: 'خروج',
  todayRevenue: 'فروش امروز',
  todayProfit: 'مفاد امروز',
  todayBills: 'بل‌های امروز',
  itemsSold: 'اقلام فروخته‌شده',
  expiryWarnings: 'هشدارهای ختم تاریخ',
  noWarnings: 'تا سه ماه آینده هیچ بچی ختم نمی‌شود 🎉',
  medicine: 'دوا',
  batch: 'بچ',
  expiryDate: 'تاریخ ختم',
  daysLeft: 'روزهای باقی',
  qty: 'مقدار',
  levelExpired: 'تاریخ گذشته',
  levelCritical: 'بسیار نزدیک',
  levelWarning: 'هشدار',
  stockSummary: 'موجودی',
  totalMedicines: 'مجموع ادویه',
  lowStock: 'موجودی کم',
  currency: 'افغانی',
  loading: 'کمی صبر…',
};

const en: Dict = {
  appName: 'Pharmacy Management System',
  login: 'Log in',
  username: 'Username',
  password: 'Password',
  loginFailed: 'Invalid username or password',
  serverDown: 'Cannot reach the server — check that the server is running',
  dashboard: 'Dashboard',
  medicines: 'Medicines',
  sales: 'Sales',
  purchases: 'Purchases',
  reports: 'Reports',
  comingSoon: 'This page will be built in the next step',
  logout: 'Log out',
  todayRevenue: "Today's sales",
  todayProfit: "Today's profit",
  todayBills: "Today's bills",
  itemsSold: 'Items sold',
  expiryWarnings: 'Expiry warnings',
  noWarnings: 'No batch expires within the next 3 months 🎉',
  medicine: 'Medicine',
  batch: 'Batch',
  expiryDate: 'Expiry date',
  daysLeft: 'Days left',
  qty: 'Qty',
  levelExpired: 'Expired',
  levelCritical: 'Critical',
  levelWarning: 'Warning',
  stockSummary: 'Stock',
  totalMedicines: 'Total medicines',
  lowStock: 'Low stock',
  currency: 'AFN',
  loading: 'Loading…',
};

const DICTS: Record<Lang, Dict> = { ps, fa, en };

export function t(lang: Lang, key: string): string {
  return DICTS[lang][key] || DICTS.ps[key] || key;
}
