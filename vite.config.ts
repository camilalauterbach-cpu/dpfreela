import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import crypto from "crypto";
import { componentTagger } from "lovable-tagger";

// Unique build identifier — regenerated on every production build.
// Injected into the bundle as __APP_VERSION__ and emitted at /version.json.
const BUILD_ID =
  process.env.BUILD_ID ||
  `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

function versionJsonPlugin() {
  return {
    name: "dpfreela-version-json",
    apply: "build" as const,
    generateBundle(this: any) {
      const payload = JSON.stringify({
        version: BUILD_ID,
        builtAt: new Date().toISOString(),
      });
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: payload,
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    versionJsonPlugin(),
  ].filter(Boolean),
  define: {
    __APP_VERSION__: JSON.stringify(mode === "development" ? "dev" : BUILD_ID),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
