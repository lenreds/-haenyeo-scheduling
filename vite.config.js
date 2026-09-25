import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// VITE_AUTH_BYPASS lets `vite` (the local dev server) skip the login screen —
// see src/AuthGate.jsx. It must never reach a build: the bypass is only
// compiled out because import.meta.env.DEV is false in a production build, and
// a build run in development mode with the flag set would ship a hub that
// skips sign-in. So any build that can see the flag — from the shell, from
// Vercel's environment variables, or from an .env file loaded for that mode —
// fails here, loudly, whatever its value. Dev servers are unaffected.
function refuseAuthBypassInBuilds(command, mode) {
  if (command !== "build") return;
  const fromFiles = loadEnv(mode, process.cwd(), "");
  const sources = [];
  if (process.env.VITE_AUTH_BYPASS !== undefined) sources.push("the build environment (shell / Vercel env vars)");
  if (fromFiles.VITE_AUTH_BYPASS !== undefined && process.env.VITE_AUTH_BYPASS === undefined) {
    sources.push(`an .env file loaded for mode "${mode}"`);
  }
  if (sources.length) {
    throw new Error(
      `\n\nBUILD REFUSED: VITE_AUTH_BYPASS is set (via ${sources.join(" and ")}).\n` +
      "That flag skips the login screen and is for the local dev server only.\n" +
      "Remove it from this build's environment (in Vercel: Settings > Environment Variables) and deploy again.\n"
    );
  }
}

export default defineConfig(({ command, mode }) => {
  refuseAuthBypassInBuilds(command, mode);
  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
  };
});
