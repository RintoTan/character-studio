// Reading shard result files back, and refusing to call an incomplete set a pass.
//
// The failure modes this exists for are the ones that look green:
//   - a shard never ran, so its checks are simply absent from the union;
//   - two shards ran the same check, inflating the count;
//   - a shard was killed mid-run, leaving a file that exists but stops halfway;
//   - a check was filtered out and its SKIP got counted as a pass.
// Every one of them produces "no failures", which is why the status is computed from
// coverage first and only then from failures.

const TERMINAL = new Set(["PASS", "FAIL", "TIMEOUT"]);
const NON_PASS = new Set(["FAIL", "TIMEOUT"]);

export function summarize({ shards, expected, totalShards }) {
  const problems = [];
  // Checks behind an env gate only count as required when the shards had that env set.
  // Every shard has to agree: mixing "with SHOTS" and "without" would silently change
  // what the union is supposed to contain.
  const env = shards[0]?.env ?? {};
  const envMismatch = shards.some((shard) => JSON.stringify(shard.env ?? {}) !== JSON.stringify(env));
  if (envMismatch) problems.push("分段的环境变量不一致（例如 SHOTS），汇总口径无法统一");
  const required = expected.filter((check) => !check.requiresEnv || env[check.requiresEnv]);
  const gated = expected
    .filter((check) => check.requiresEnv && !env[check.requiresEnv])
    .map((check) => ({ id: check.id, name: check.name, env: check.requiresEnv }));
  const byIndex = new Map();

  for (const shard of shards) {
    const index = shard.shard?.index ?? shard.shardIndex;
    if (!Number.isInteger(index)) {
      problems.push(`分段文件缺少分段编号：${shard.file ?? "(unknown)"}`);
      continue;
    }
    if (byIndex.has(index)) {
      problems.push(`分段编号重复：${index}（另外还有 ${byIndex.get(index).file ?? "一个文件"}）`);
      continue;
    }
    byIndex.set(index, shard);
  }

  const missingShards = [];
  for (let index = 1; index <= totalShards; index += 1) {
    if (!byIndex.has(index)) missingShards.push(index);
  }
  if (missingShards.length > 0) {
    problems.push(`缺少分段：${missingShards.join(", ")}`);
  }

  const fingerprints = new Set(
    [...byIndex.values()].map((shard) => shard.build?.distEntry ?? "(none)"),
  );
  if (fingerprints.size > 1) {
    problems.push(`分段来自不同的构建产物：${[...fingerprints].join(" / ")}`);
  }

  const interrupted = [];
  const seen = new Map();
  const duplicates = [];
  const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, SKIP: 0, other: 0 };
  const checks = [];

  for (const shard of byIndex.values()) {
    for (const check of shard.checks ?? []) {
      const id = check.id;
      if (!id) {
        problems.push(`检查缺少 id：${check.name ?? "(unnamed)"}`);
        continue;
      }
      if (seen.has(id)) {
        duplicates.push(id);
        continue;
      }
      seen.set(id, check);
      checks.push(check);
      if (check.status === "PASS") counts.PASS += 1;
      else if (check.status === "FAIL") counts.FAIL += 1;
      else if (check.status === "TIMEOUT") counts.TIMEOUT += 1;
      else if (check.status === "SKIP") counts.SKIP += 1;
      else counts.other += 1;

      // A pass that was not actually executed is the one lie a result file can tell.
      if (check.status === "SKIP" && check.pass === true) {
        problems.push(`跳过项被记为通过：${check.name}`);
      }
      if (!TERMINAL.has(check.status) && check.status !== "SKIP") {
        problems.push(`检查没有终态：${check.name}（${check.status ?? "undefined"}）`);
      }
    }
    if (shard.finished !== true) {
      interrupted.push(shard.shard?.index ?? shard.shardIndex ?? "?");
    }
  }
  if (interrupted.length > 0) {
    problems.push(`分段未跑完（进程中断）：${interrupted.join(", ")}`);
  }

  const expectedIds = required.map((check) => check.id);
  const missing = expectedIds.filter((id) => !seen.has(id));
  const extra = [...seen.keys()].filter((id) => !expectedIds.includes(id));
  if (missing.length > 0) {
    problems.push(`缺少检查 ${missing.length} 项：${missing.slice(0, 6).join(", ")}${missing.length > 6 ? " …" : ""}`);
  }
  if (extra.length > 0) {
    problems.push(`多出计划外的检查 ${extra.length} 项：${extra.slice(0, 6).join(", ")}`);
  }
  if (duplicates.length > 0) {
    problems.push(`同一检查出现在多个分段 ${duplicates.length} 项：${duplicates.slice(0, 6).join(", ")}`);
  }

  const failed = checks.filter((check) => NON_PASS.has(check.status));
  const complete = problems.length === 0;

  return {
    status: complete ? (failed.length > 0 ? "FAIL" : "PASS") : "INCOMPLETE",
    complete,
    coverage: { expected: expectedIds.length, executed: seen.size, missing: missing.length, extra: extra.length },
    gated,
    counts,
    problems,
    failed: failed.map((check) => ({ id: check.id, name: check.name, status: check.status, detail: check.detail })),
    checks,
  };
}

/** The one-line verdict the report and the shell both quote. */
export function formatSummary(summary, { totalShards } = {}) {
  const head =
    summary.status === "PASS"
      ? `PASS  ${summary.coverage.executed}/${summary.coverage.expected} 项全部通过`
      : summary.status === "FAIL"
        ? `FAIL  ${summary.counts.FAIL + summary.counts.TIMEOUT} 项失败（覆盖 ${summary.coverage.executed}/${summary.coverage.expected}）`
        : `INCOMPLETE  覆盖 ${summary.coverage.executed}/${summary.coverage.expected}，问题 ${summary.problems.length} 条`;
  const lines = [head];
  if (totalShards) lines.push(`分段：${totalShards}`);
  for (const problem of summary.problems) lines.push(`  - ${problem}`);
  for (const check of summary.failed) lines.push(`  × [${check.status}] ${check.name}\n      ${check.detail ?? ""}`);
  return lines.join("\n");
}
