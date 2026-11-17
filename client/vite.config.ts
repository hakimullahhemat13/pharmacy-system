import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host: true lets a phone on the same Wi-Fi open the app via the
  // computer's network address (http://<computer-IP>:5173).
  // allowedHosts: true lets the app open via a Tailscale MagicDNS name
  // (http://pharmacy.<tailnet>.ts.net:5173) — without it Vite rejects
  // any host that is not localhost or a bare IP ("not allowed").
  server: { port: 5173, host: true, allowedHosts: true },
});
