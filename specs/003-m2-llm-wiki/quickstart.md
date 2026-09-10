# Quickstart: M2 LLM Wiki 验证指南

**Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

命令契约见 [contracts/cli.md](contracts/cli.md)，磁盘格式见
[contracts/wiki-format.md](contracts/wiki-format.md)，数据结构见
[data-model.md](data-model.md)。

## 前置条件

- M0/M1 基线可用（`pnpm check` 全绿；`fleet repo investigate` 正常）
- 本仓库为 git 仓库（真实 HEAD 锚定）；无需 codegraph（wiki 不依赖
  任何加速器）

## A. 初始化与构建（US1 / SC-001）

```bash
pnpm build
pnpm fleet wiki init
pnpm fleet wiki build --json
```

**预期**：

- `.fleet/wiki/` 出现完整结构（index + 四分区 + glossary，见
  wiki-format.md）；重复执行 init/build 幂等（第二次 build 的
  `pagesUnchanged` 覆盖全部页面）。
- 每页 front matter 三要素齐全，generated_from = 当前 HEAD sha；
  index.md 收录全部页面。
- init + build 合计 ≤ 30s（SC-001；本仓库规模预期 < 2s），输出
  validation.ok = true。

**锚定抽查（FR-004）**：任选 domains/ 下两页，打开其中反引号路径
引用（如 `packages/core/src/index.ts`）——文件必须真实存在。

## B. 提问检索（US2 / SC-006 + SC-002 认知走查）

```bash
pnpm fleet wiki query "core 包提供哪些模块"
pnpm fleet wiki query "investigate 命令在哪个包实现" --json
pnpm fleet wiki query "zzz不存在的主题xyz"
```

**预期**：

- 前两问返回相关页面 + 片段，`--json` 含 scoreBreakdown；命中
  查询 ≤ 2s（SC-006），退出码 0。
- 第三问返回空结果 + suggestions（index 页面标题全集），退出码 0
  （无结果 ≠ 失败）。

**SC-002 走查（M2 验收锚点）**：开一个全新 Codex 会话，只允许其
读 `.fleet/wiki/`（禁止读源码），回答 5 个结构问题：

1. fleet 有哪些包，各自职责？
2. investigate 命令在哪个包实现？
3. repository 包依赖哪些内部包？
4. 构建与测试用什么工具链？
5. CLI 目前有哪些命令族？

≥ 4/5 正确即达标（80%）。判定后允许定向跳源码复核，但答题阶段
不得读源码。

## C. 增量更新与 stale（US3 / SC-003 / SC-004）

在 tmp 副本上做（避免污染本仓库历史）：

```bash
cp -R . /tmp/wiki-verify && cd /tmp/wiki-verify
pnpm fleet wiki build --json          # 记录 baseline
echo "// touch" >> packages/repository/src/index.ts
git add -A && git commit -m "touch repository"
pnpm fleet wiki status --json
pnpm fleet wiki update --json
```

**预期**：

- status：state = stale；changedFiles 含 index.ts；pages 明细中
  scope 命中 `packages/repository` 的页面（domains/repository.md、
  overview 等）stale = true，其余（如 domains/core.md）stale = false
  ——**纯集合运算，100% 准确（SC-004）**。
- update：`pagesWritten` 恰好 = 受影响的 generated/mixed 页全集；
  `git diff .fleet/wiki` 显示无关页面零变化（SC-003 逐字节不变）。

**人工内容保护（FR-009）**：在某 mixed 页围栏外加一段文字，执行
update——该段文字原样保留，`.fleet/wiki/.backup/` 出现上一代备份。

自动化等价物：`tests/cli/wiki.test.ts` 覆盖同一矩阵（tmp git 夹具
仓库），**测试即验收证据**；手工走查用于抽样确认。

## D. 隔离对照（宪法 I / SC-005）

```bash
pnpm fleet repo investigate "FleetError 在哪里被抛出" > /tmp/before.txt
rm -rf .fleet/wiki
pnpm fleet repo investigate "FleetError 在哪里被抛出" > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo ISOLATED
pnpm fleet doctor          # 仍全绿，wiki 缺失不产生任何失败项
pnpm fleet wiki query "任意"   # 退出码 1 + 修复指引（先 init/build）
```

**预期**：diff 为空（investigate 输出与 wiki 存在与否完全无关）、
doctor 无 wiki 相关回归、query 缺失态给出明确指引。

## 完成判定

以上全部通过 = M2 验收（roadmap M2：Wiki 可初始化、导航、增量更新
和识别 stale；Wiki 不存在时 Repository Investigation 仍可工作）。
