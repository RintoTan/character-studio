// Turning the browser suite into something that can be run in pieces.
//
// The suite is 90 `await check(...)` calls in one file, and it outgrew the platform's
// 900s cap: the last full run stopped at check 78 with no way to say whether the
// remaining twelve ever ran. Sharding needs three things the file does not provide --
// a stable identity per check, a deterministic way to split them, and a result file that
// survives the process being killed mid-run.
//
// Identity is derived from the check's *name*, not its position: inserting a check in the
// middle of the file must not renumber everything after it. A name registered twice (the
// suite has three such pairs) gets an occurrence suffix, so "the same check twice" stays
// visible instead of collapsing into one entry.
import { createHash } from "node:crypto";

/** Names in source order. Interpolated calls (`check(\`...\`)`) are not used by the suite. */
export function collectChecks(source) {
  const pattern = /await check\(\s*"((?:[^"\\]|\\.)*)"\s*,/g;
  const checks = [];
  for (const match of source.matchAll(pattern)) {
    const index = source.slice(0, match.index).split("\n").length;
    checks.push({ name: match[1], line: index });
  }
  return checks;
}

export function checkId(name, occurrence = 1) {
  const digest = createHash("sha1").update(name).digest("hex").slice(0, 8);
  return occurrence > 1 ? `c${digest}-${occurrence}` : `c${digest}`;
}

/**
 * One entry per *registration*, so a duplicated name yields two entries with distinct ids.
 * `weight` is the expected cost in seconds; unknown checks fall back to `defaultWeight`.
 */
export function buildPlan(checks, weights = {}, defaultWeight = 12) {
  const seen = new Map();
  return checks.map((check, position) => {
    const occurrence = (seen.get(check.name) ?? 0) + 1;
    seen.set(check.name, occurrence);
    return {
      id: checkId(check.name, occurrence),
      name: check.name,
      position: position + 1,
      occurrence,
      weight: Number(weights[check.name] ?? defaultWeight),
      // Two registrations live inside `if (process.env.SHOTS)`, so a normal run never
      // reaches them. Counting them as "missing" would make every run INCOMPLETE; the
      // gate is declared here instead, and the summariser only requires them when the
      // shard actually had SHOTS set.
      requiresEnv: check.name.startsWith("截图（SHOTS=") ? "SHOTS" : null,
    };
  });
}

/**
 * Contiguous shards, cut where the running weight crosses each target.
 *
 * Contiguous rather than round-robin on purpose: these checks drive one browser through
 * one session, and a check's outcome depends on what ran before it. Keeping the original
 * order inside a shard keeps a shard reproducible; only the cut points move. Cutting by
 * weight rather than by count keeps five 90s checks from landing in the same shard.
 */
export function assignShards(plan, totalShards) {
  if (!Number.isInteger(totalShards) || totalShards < 1) {
    throw new Error(`分段数必须是正整数：${totalShards}`);
  }
  if (plan.length < totalShards) {
    throw new Error(`检查数（${plan.length}）少于分段数（${totalShards}）`);
  }
  const n = plan.length;
  const prefix = [0];
  plan.forEach((check, index) => prefix.push(prefix[index] + check.weight));
  const weight = (from, to) => prefix[to] - prefix[from]; // checks [from, to)

  // contiguity comes from the suite, not from taste: a check's outcome depends on what
  // ran before it. Within that constraint, pick the cuts that make the heaviest shard as
  // light as possible -- otherwise the five 90s checks end up in one piece and that
  // piece is the one that hits the platform cap.
  const INF = Number.POSITIVE_INFINITY;
  const best = Array.from({ length: totalShards + 1 }, () => new Array(n + 1).fill(INF));
  const cut = Array.from({ length: totalShards + 1 }, () => new Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let shards = 1; shards <= totalShards; shards += 1) {
    for (let end = shards; end <= n; end += 1) {
      for (let start = shards - 1; start < end; start += 1) {
        const candidate = Math.max(best[shards - 1][start], weight(start, end));
        if (candidate < best[shards][end]) {
          best[shards][end] = candidate;
          cut[shards][end] = start;
        }
      }
    }
  }

  const bounds = [n];
  let end = n;
  for (let shards = totalShards; shards >= 1; shards -= 1) {
    end = cut[shards][end];
    bounds.unshift(end);
  }

  return plan.map((check, index) => {
    let shard = 1;
    for (let i = 1; i <= totalShards; i += 1) {
      if (index >= bounds[i - 1] && index < bounds[i]) {
        shard = i;
        break;
      }
    }
    return { ...check, shard };
  });
}

export function shardOf(plan, totalShards, index) {
  return assignShards(plan, totalShards).filter((check) => check.shard === index);
}

export function describe(plan, totalShards = 0) {
  return {
    total: plan.length,
    uniqueNames: new Set(plan.map((check) => check.name)).size,
    gated: plan.filter((check) => check.requiresEnv).map((check) => ({ id: check.id, name: check.name, env: check.requiresEnv })),
    duplicates: plan
      .filter((check) => check.occurrence > 1)
      .map((check) => ({ name: check.name, id: check.id, occurrence: check.occurrence })),
    shards:
      totalShards > 0
        ? Array.from({ length: totalShards }, (_, i) => {
            const slice = plan.filter((check) => check.shard === i + 1);
            return {
              index: i + 1,
              count: slice.length,
              weight: slice.reduce((sum, check) => sum + check.weight, 0),
              first: slice[0]?.name ?? null,
              last: slice[slice.length - 1]?.name ?? null,
            };
          })
        : [],
  };
}
