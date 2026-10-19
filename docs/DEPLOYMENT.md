# Character Studio —— 构建与部署

> 用途：发布、回滚或排查「线上不是最新」时读这一份。事实来源：`package.json`、`.github/workflows/deploy-pages.yml`、`scripts/verify-deploy.mjs`、`scripts/build-info.mjs`。
> 最近核对：2026-10-19（2.37.1）。

---

## 1. 站点结构

- 托管：GitHub Pages，仓库 `RintoTan/character-studio`
- 地址：<https://rintotan.github.io/character-studio/>
- 子路径：`/character-studio/`，因此所有构建必须使用 `pnpm build:pages`（`vite build --base=/character-studio/`）
- 页面：无路由库，使用 History API；Pages 对未知子路径返回 `index.html`，由应用自行还原页面

> 用 `pnpm build`（根路径）构建的产物**不能**直接部署到 Pages，资源会 404。

---

## 2. CI 流程

`.github/workflows/deploy-pages.yml`，在 `main` 被推送或手动触发时运行：

1. `pnpm install --frozen-lockfile`（pnpm 10 / Node 22）
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build:pages`，注入 `VITE_BUILD_COMMIT` 与 `VITE_BUILD_TIME`
5. 上传 `dist` 为 Pages 产物
6. `deploy-pages@v4` 发布

CI 失败时不会部署；已部署的旧版本保持在线。

---

## 3. 构建身份

`scripts/build-identity.mjs` 决定 `build-info.json` 中的 `commit`、`commitShort`、`builtAt`：

- 环境变量优先（CI 注入 `VITE_BUILD_COMMIT` / `VITE_BUILD_TIME`）
- 否则从 Git 推导（`rev-parse HEAD`、`log -1 --format=%cI`）
- 工作树有未提交改动时，提交号带 `-dirty` 后缀——一个不可能与线上一致的构建会自己说明这一点

`build-info.json` 同时记录入口 chunk、样式文件名与每个产物的字节数，供 `verify:deploy` 比对。

---

## 4. 发布步骤

1. 确认 `src/config/version.ts` 与 `package.json` 版本一致：`pnpm verify:version`
2. 本地最终检查：`pnpm typecheck && pnpm test && pnpm build:pages && pnpm verify:browser`
3. 更新 `CHANGELOG.md`、`docs/PROJECT_STATUS.md`，必要时更新 README 的版本行
4. 提交发布 commit
5. 确认远端没有分叉：`git ls-remote <remote> refs/heads/main`，本地必须能 fast-forward
6. 推送 `main`（**禁止** `push --force`）
7. 等待 Actions 的 build 与 deploy 两个 job 成功
8. 在**最终 commit** 上重新构建，再运行 `pnpm verify:deploy`

`verify:deploy` 会核对：

- 线上 `index.html` 可访问
- 入口 chunk 与样式文件名和本地一致
- 线上 `build-info.json` 的 commit 与本地 HEAD 一致
- 所有产物字节数一致
- 未知子路径（如 `/developer`）仍返回应用外壳

任何一项失败都视为部署未完成，不要对外宣布发布成功。

---

## 5. 版本规则

| 变更 | 版本 |
| --- | --- |
| 新功能 / 新模块 | minor |
| 修复、样式与文案调整 | patch |
| 仅文档与仓库整理 | 不改版本 |

`APP_SPRINT` 记录交付阶段而不是版本号：同一 Sprint 的补丁不改变 Sprint 值。版本必须同时改 `src/config/version.ts` 与 `package.json`，否则 `verify:version` 失败。

---

## 6. 回滚

1. `git revert <发布 commit>`，解决冲突后提交
2. 推送 `main`，等待 CI 自动重新部署
3. 重新构建并运行 `pnpm verify:deploy`

不要手动删除线上文件，也不要强推历史。若 CI 本身故障，可在 Actions 页面重跑对应 workflow；仍失败时先停止发布并排查。

---

## 7. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 页面空白、控制台大量 404 | 用了根路径构建；改用 `build:pages` |
| 线上仍是旧版本 | CI 未完成或被跳过；查看 Actions 运行记录 |
| `verify:deploy` 报入口 chunk 不一致 | 线上尚未完成部署，或本地未在最终 commit 上重新构建 |
| 刷新子页面 404 | Pages 回退规则缺失；确认 `index.html` 与部署产物完整 |
| 已打开的标签页报懒加载 404 | 部署替换了带哈希的 chunk；应用有一次性自愈刷新，刷新后仍失败则按真实缺陷排查 |
| 工作树是脏的 | `build-info` 会带 `-dirty`，不可能与线上一致；提交后再构建 |
