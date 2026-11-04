# Pharmacy System — Starter (Server v0.1)

لومړی چلول (First run) — په PowerShell کې:

1. دې فولډر ته لاړ شه:
   ```
   cd server
   ```
2. `.env` جوړ کړه او ډک یې کړه:
   ```
   Copy-Item .env.example .env
   code .env
   ```
   - `DB_PASSWORD` = د pharmacy_app پاسورډ (ستا کتابچه کې دی)
   - `JWT_SECRET` = اوږد تصادفي متن (لږ تر لږه ۳۲ تورې) — په خپله یې ولیکه
   - `.env` مه هېروه: دا فایل GitHub ته **نه** ځي
3. Packages نصب کړه:
   ```
   npm install
   ```
4. Server وچلوه:
   ```
   npm run dev
   ```
5. په Browser کې پرانېزه:
   ```
   http://localhost:5000/api/health
   ```
   تمه: `{"status":"ok","database":"connected"}`

Server بندول: په Terminal کې `Ctrl + C`
