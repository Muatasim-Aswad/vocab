import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, lazyPlugins } from "vite-plus";

import { buildInfo } from "./build-info.ts";

// Browser chrome colors; mirror the light and dark `--color-canvas` tokens in `src/app/styles.css`.
const canvasLight = "#f7f9fc";

export default defineConfig({
  plugins: lazyPlugins(() => [
    react(),
    tailwindcss(),
    buildInfo(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // Adds a same-origin `registerSW.js` script, which the HTML CSP allows; dev runs without a worker.
      injectRegister: "script",
      manifest: {
        id: "/",
        name: "Vocab",
        short_name: "Vocab",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: canvasLight,
        theme_color: canvasLight,
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{html,js,css,woff2,svg,png,webmanifest}"],
        // Icon sources only render the PNGs.
        globIgnores: ["icons/*.svg"],
      },
    }),
  ]),
  server: {
    proxy: {
      "/api": {
        target: process.env.VOCAB_API_URL ?? "http://127.0.0.1:3000",
        // Preserve the browser Host for the API's same-origin login check.
        changeOrigin: false,
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "happy-dom",
    // Whole user flows through the rendered app; the 5 s default fails them on a busy machine.
    testTimeout: 20_000,
  },
  run: {
    tasks: {
      // Git identity and dirty source can change without a task input changing.
      build: {
        command: "vp build",
        cache: false,
      },
      test: "vp test run",
    },
  },
});
