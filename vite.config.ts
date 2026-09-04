import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Marginalia — schedule & todos",
        short_name: "Marginalia",
        description: "A free voice/text planner that keeps what you need to do.",
        theme_color: "#23201b",
        background_color: "#f6f3ec",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        skipWaiting: true,
        clientsClaim: true
      }
    })
  ],
  server: { host: true }
});
