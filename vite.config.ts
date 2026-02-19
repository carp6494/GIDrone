import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "GI Drone - Mission Safety",
        short_name: "GIDrone",
        theme_color: "#0f172a",
        background_color: "#020617",
        display: "standalone",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2,woff,ttf}"],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("node_modules/mapbox-gl")) return "mapbox-gl"
          if (id.includes("node_modules/lucide-react")) return "lucide-react"
          if (id.includes("node_modules/@supabase/") || id.includes("node_modules/supabase")) {
            return "supabase"
          }
          if (id.includes("papaparse")) return "papaparse"
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
