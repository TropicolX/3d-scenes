import { devBridge } from './tools/vite-dev-bridge.js';

export default {
  plugins: [devBridge()],
  server: { port: 5180, strictPort: false },
  build: { target: 'es2020' },
};
