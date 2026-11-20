import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hakimullahhemat.pharmacy',
  appName: 'هڅاند درملتون',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    cleartext: true,
  },
};

export default config;
