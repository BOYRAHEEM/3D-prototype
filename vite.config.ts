import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// GitHub Pages serves the site from https://<user>.github.io/skydoodle/,
// so production builds need that sub-path as their base. Override with
// VITE_BASE=/ (e.g. for Vercel or a custom domain). Dev server always uses '/'.
//
// WebXR only works on secure origins. localhost counts as secure, but a Quest
// headset reaching your PC over Wi-Fi does not, so `npm run dev:https` serves
// with a self-signed certificate (accept the warning once in the headset).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.VITE_BASE ?? '/skydoodle/') : '/',
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  server: { host: true, port: 5173 },
  // three.js alone is ~600 kB minified; that's expected for a 3D app.
  build: { chunkSizeWarningLimit: 900 },
}));
