# Implementation Plan: M3 Evidence System（调查证据体系）

**Branch**: `004-m3-evidence-system` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-m3-evidence-system/spec.md`

## Summary

把 investigate 的输出从"引用列表"升级为"证据化结论"：新增
`packages/repository/src/evidence/` 模块（模式裁决与高风险强制
VERIFY、wiki 证据源接入 M2 检索、config 证据重分类、确定性
Finding 合成与 confidence 推导、位置级冲突裁决）。investigate
编排扩展 wiki 加速阶段与 findings 汇编层，M1 的 references/
fallbacks 契约原样保留为兼容层。零新增第三方依赖；宪法 I 的
"删除 wiki 调查不失败"在集成后由测试重新钉死。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同 M0 基线）

**Primary Dependencies**: 零新增——复用 execa / Zod / yaml /
commander / Vitest / tsup；复用 M1 searchPatterns / verifyAnchor /
CodeGraphAdapter / FakeCodeGraphAdapter 与 M2 queryWiki /
loadWikiPages / pathExists

**Storage**: 无新持久化；evidence/findings 为内存结果实体
（随 investigate 结果返回），wiki 仍归 `.fleet/wiki/`（M2 既有）

**Testing**: Vitest 三层——单元（FakeCodeGraphAdapter +
MemoryFileSystem + 假 wiki，全矩阵确定性）、进程级 e2e
（tests/cli 夹具仓库：fast/verify 对照、高风险升级、wiki 接入
与删除隔离、冲突注入）、本仓库真实走查（quickstart）

**Target Platform**: macOS 本地（同 M0–M2）

**Project Type**: monorepo 现有 packages/repository 新增 evidence
模块 + investigate 编排扩展 + CLI 选项

**Performance Goals**: FAST 健康路径 ≤ 10s（SC-006，沿用 M1 预算）
且不高于同问题 VERIFY；evidence 单 finding 上限（默认 10 条，
FR-010）；调查总预算沿用 M1

**Constraints**: 全部规则确定性无 LLM（宪法 V / FR-011）；
conflict 检测限位置/存在性级；wiki 集成不得破坏宪法 I 隔离
（SC-004 = M2 SC-005 的集成后版本）

**Scale/Scope**: 单仓库调查；五源证据（wiki/codegraph/search/
source/config）；高风险矩阵六类 100% 升级（SC-002）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | wiki 接入仅作加速源（缺失/stale/损坏三态降级码）；冲突 Static Truth 胜出并留 EvidenceConflict；SC-004 集成后重验隔离 | PASS |
| II. 权限与隔离 | evidence 模块只读仓库与 `.fleet/wiki`；无 Agent 角色 | PASS |
| III. Independent Validation | N/A（无实现型角色自报问题） | PASS |
| IV. Role/Runtime 解耦 | 不引入 Runtime；wiki/codegraph 证据源经既有适配层（FakeCodeGraphAdapter 可替换语义延续） | PASS |
| V. Deterministic Kernel First | 模式裁决、高风险判定、confidence、Finding 合成全部为确定性规则（无 LLM、无随机） | PASS |
| VI. Reuse Over Reimplementation | 检索复用 M2 queryWiki、锚定复用 M1 verifyAnchor、搜索复用 searchPatterns；零新增依赖 | PASS |
| Architecture Constraints 技术栈 | 全部沿用既有依赖 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（无语义级冲突检测 = 显式排除 LLM 依赖） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/004-m3-evidence-system/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── cli.md           # investigate --mode 与 findings 输出契约
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root，M3 增量)

```text
packages/repository/src/evidence/
├── types.ts            # Evidence / Finding / EvidenceConflict / ModeResolution 实体
├── rules.ts            # 模式裁决（auto/fast/verify + 高风险强制升级表）
├── wiki-source.ts      # wiki 证据源：queryWiki 复用 + fresh/stale/missing 判定
├── confidence.ts       # 证据构成 → confidence 确定性推导（规则表）
└── resolver.ts         # references + wiki hits + config 重分类 → Findings 合成

packages/repository/src/investigation/
├── types.ts            # 扩展：FallbackReason 新码（wiki_missing/stale/broken）+ InvestigationResult 增 findings/mode
└── investigate.ts      # 扩展：wiki 加速阶段、mode 贯穿、FAST 跳过强制锚定、findings 汇编

apps/cli/src/commands/repo.ts            # --mode 选项 + findings 渲染（文本/JSON）

tests/cli/investigate-evidence.test.ts   # e2e：模式矩阵 / wiki 接入与隔离 / 冲突注入
```

**Structure Decision**: evidence 为 repository 包内新子模块（roadmap
最终结构 `packages/repository/evidence/` 的落位）；investigation/
types.ts 与 investigate.ts 原地扩展（M1 契约字段不动，只增可选层）；
CLI 不新增命令族（spec Assumption）。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
