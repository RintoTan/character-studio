import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The same derivation as scripts/build-identity.mjs, repeated here because the
// config is loaded in its own resolution context. Both call sites exist for one
// reason: `src/config/version.ts` reads these two values through `import.meta.env`,
// Vite inlines them into the bundle, so a build that passes one and not the other
// produces different JS from the deployment.
function git(args: string[]) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const explicitCommit = process.env.VITE_BUILD_COMMIT || process.env.GITHUB_SHA || "";
const commit = explicitCommit || git(["rev-parse", "HEAD"]) || "local";
const builtAt = process.env.VITE_BUILD_TIME || git(["log", "-1", "--format=%cI"]) || new Date().toISOString();
const dirty = !explicitCommit && git(["status", "--porcelain"]).length > 0;

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(dirty ? `${commit}-dirty` : commit),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(builtAt),
  },
});
