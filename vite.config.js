import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";

// Prefer IPv4 when resolving HTTPS proxy targets (fixes some Windows/ngrok TLS handshake drops on broken IPv6 routes).
dns.setDefaultResultOrder("ipv4first");

/** Pool outbound connections so repeated API calls are less likely to hit flaky TLS closes (socket hang up). */
function outboundAgentForOrigin(origin) {
  if (!origin || typeof origin !== "string") return undefined;
  if (origin.startsWith("https:")) {
    return new https.Agent({ keepAlive: true, maxSockets: 50 });
  }
  if (origin.startsWith("http:")) {
    return new http.Agent({ keepAlive: true, maxSockets: 50 });
  }
  return undefined;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBase = (env.API_URL || env.VITE_API_BASE || "http://localhost:8000").replace(/\/$/, "");
  const outboundAgent = outboundAgentForOrigin(apiBase);

  return {
    plugins: [react()],
    envPrefix: ['VITE_', 'API_'],
    server: {
      port: 5174,
      strictPort: false,
      host: true,
      proxy: {
        // Forward all /api/ requests to the Django backend (no CORS issue)
        "/api": {
          target: apiBase,
          changeOrigin: true,
          secure: true,
          agent: outboundAgent,
          timeout: 120000,
          proxyTimeout: 120000,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("ngrok-skip-browser-warning", "1");
            });
            proxy.on("error", (err, req) => {
              console.error(
                "[vite proxy]",
                err.message,
                "| API:",
                apiBase,
                "| path:",
                req?.url ?? ""
              );
            });
          },
        },
      },
    },
  };
});
