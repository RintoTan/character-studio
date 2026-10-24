#!/usr/bin/env node
// Merge shard results and say whether the *set* is trustworthy, not just green.
//
//   node scripts/verify-browser-summary.mjs --dir=tmp/verify-browser --shards=3 [--json=path]
//
// Exit codes: 0 PASS, 1 FAIL (everything ran, something failed), 3 INCOMPLETE.
// The distinction matters: "some checks failed" and "we do not know what ran" are
// different problems and only one of them is about the product.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assignShards, buildPlan, collectChecks, describe } from "./lib/verify-plan.mjs";
import { summarize, formatSummary } from "./lib/verify-results.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = args.find((argument) => argument.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
};

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, flag("dir", "tmp/verify-browser"));
const totalShards = Number(flag("shards", "3"));
const outPath = flag("json", join(dir, "summary.json"));

const weights = JSON.parse(readFileSync(join(root, "scripts/lib/check-weights.json"), "utf8"));
const plan = buildPlan(collectChecks(readFileSync(join(root, "scripts/verify-browser.mjs"), "utf8")), weights);

const files = readdirSync(dir).filter((name) => /^shard-\d+-of-\d+\.json$/.test(name)).sort();
const shards = files.map((name) => {
  const parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
  return { ...parsed, file: name };
});

const summary = summarize({ shards, expected: plan, totalShards });
const report = {
  generatedAt: new Date().toISOString(),
  totalShards,
  plan: describe(assignShards(plan, totalShards), totalShards),
  shardFiles: files,
  ...summary,
};
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(formatSummary(summary, { totalShards }));
console.log(`\n分段文件：${files.length} / ${totalShards}（${dir}）`);
console.log(`机器可读结果：${outPath}`);

process.exit(summary.status === "PASS" ? 0 : summary.status === "FAIL" ? 1 : 3);
