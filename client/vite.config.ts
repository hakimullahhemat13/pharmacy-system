import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host: true lets a phone on the same Wi-Fi open the app via the
  // computer's network address (http://<computer-IP>:5173).
  server: { port: 5173, host: true },
});
