// The identity of a build, derived the same way on a laptop and in CI.
//
// This is why local rebuilds used not to be byte-identical to the deployed bundle:
// src/config/version.ts inlines both values, CI passed both, and a plain local
// `npm run build:pages` passed neither. The JS then differed while the CSS did not
// — which is exactly the pattern that made a tooling gap look like a deployment
// fault. A dirty tree is marked, so a build that cannot match a deployment says so
// instead of looking deployable.
import { execFileSync } from "node:child_process";

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function buildIdentity() {
  const explicitCommit = process.env.VITE_BUILD_COMMIT || process.env.GITHUB_SHA || "";
  const commit = explicitCommit || git(["rev-parse", "HEAD"]) || "local";
  const builtAt =
    process.env.VITE_BUILD_TIME || git(["log", "-1", "--format=%cI"]) || new Date().toISOString();
  // CI always supplies the commit, and CI is never "dirty".
  const dirty = !explicitCommit && git(["status", "--porcelain"]).length > 0;

  return { commit: dirty ? `${commit}-dirty` : commit, builtAt };
}
