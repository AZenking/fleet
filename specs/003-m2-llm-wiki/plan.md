# Implementation Plan: M2 LLM Wiki（仓库持久知识层）

**Branch**: `003-m2-llm-wiki` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-m2-llm-wiki/spec.md`

## Summary

建立 Repository Persistent Knowledge Layer：`fleet wiki init / build /
status / update / query` 五命令管理 `.fleet/wiki/` Markdown 知识库
（front matter 元数据 + generated 围栏 + index 导航）。build 以确定性
事实提取（目录扫描 + package.json + 模块注释）产出页面骨架，人工/
外部 LLM 内容经围栏机制受保护；status/update 按 git diff → scope
前缀映射做页面级 stale 判定与增量重算；query 复用 M1 的 ripgrep→walk
检索链并做确定性相关度排序。零新增第三方依赖，investigate 与 doctor
代码零改动（`.fleet` 已在 M1 排除清单中，宪法原则 I 隔离天然成立）。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24（同 M0 工程基线）

**Primary Dependencies**: 零新增第三方依赖——复用 execa / Zod / yaml /
commander / Vitest / tsup（M0 已装）；外部工具依赖 `git`（只读：
rev-parse / diff --name-only）、`rg`（缺失时降级内置遍历，沿用 M1
searchPatterns 双引擎）

**Storage**: 无数据库；`.fleet/wiki/` 下 Markdown 文件 + YAML front
matter（宪法 VI：无向量库）；git 可管理，是否提交由用户决定

**Testing**: Vitest 三层——单元（core MemoryFileSystem 注入，不触磁盘）、
进程级 e2e（tests/cli/wiki.test.ts，tmp 目录 + git init 夹具仓库）、
本仓库真实走查（quickstart，SC-002 认知走查）

**Target Platform**: macOS 本地（同 M0/M1）

**Project Type**: monorepo 现有 packages/repository 新增 wiki 模块 +
CLI 新命令族

**Performance Goals**: init+build ≤ 30s（SC-001，本仓库规模预期 < 2s）；
query 命中 ≤ 2s（SC-006）；walk 检索结果上限沿用 M1（100 条）

**Constraints**: 确定性生成/更新/判定（FR-011，无 LLM 运行时依赖）；
宪法 I——wiki 任何状态不影响既有命令（FR-010）；宪法 VI——无向量库、
零新增依赖；Static Truth——页面路径引用必须锚定真实文件（FR-004）

**Scale/Scope**: 单仓库知识层（monorepo 感知：pnpm workspace 包清单；
非 monorepo 仓库降级为 src/ 结构扫描）；增量更新受影响页面刷新率
100% / 无关页面 0 变化（SC-003）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 评估 | 结果 |
|---|---|---|
| I. Repository Truth Model | wiki 定位加速器：`.fleet` 已在 investigate 排除目录，wiki 页面不可能成为源码证据；页面死引用以仓库为准（validator）；缺失/stale 只提示不阻塞（FR-006/010） | PASS |
| II. 权限与隔离 | M2 无 Agent 角色；wiki 模块只写 `.fleet/wiki/`，不触碰源码与 `.codegraph` | PASS |
| III. Independent Validation | N/A（无实现型角色自报问题） | PASS |
| IV. Role/Runtime 解耦 | 生成/更新/判定全确定性规则；内容源可插拔（人工/外部 LLM 写入受同一格式与校验约束），不引入任何 Runtime 依赖 | PASS |
| V. Deterministic Kernel First | build/update/status/query 均为纯规则流水，无 LLM、无动态规划 | PASS |
| VI. Reuse Over Reimplementation | 无向量库；rg/git/yaml 全部复用现成工具与既有依赖；front matter 解析自研轻量 split（yaml 库复用），不引入 gray-matter | PASS |
| Architecture Constraints 技术栈 | 全部沿用 M0/M1 已装依赖，零新增 | PASS |
| Non-Goals（Fleet 1.0 前） | 未触碰（无向量库、无长期记忆、无 GUI） | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/003-m2-llm-wiki/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── cli.md           # fleet wiki 五命令契约
│   └── wiki-format.md   # .fleet/wiki 文件格式契约（front matter/围栏/index）
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root，M2 增量)

```text
packages/repository/src/wiki/
├── types.ts            # 实体 + front matter Zod schema
├── format.ts           # front matter 解析/序列化 + generated 围栏解析/重写
├── git.ts              # 只读 git：HEAD sha / diff --name-only（严格错误，区别于 fallback/git.ts 的容错辅助）
├── generator/
│   └── skeleton.ts     # 确定性事实提取 → 页面骨架（monorepo 包清单 / 非 monorepo src 兜底）
├── index-writer.ts     # index.md 生成（页面清单 → 层级导航）
├── validator.ts        # 两级校验：generated 区块路径锚定 + 全文 markdown 链接可达
├── status.ts           # 页面级 stale 判定（changed files ∩ scope）
├── updater.ts          # 增量更新：scope 匹配 → 围栏内重写（manual/mixed 保护）
└── query.ts            # 关键词提取 + searchPatterns(wikiRoot) 复用 + 确定性排序

apps/cli/src/commands/wiki.ts        # fleet wiki init/build/status/update/query 注册

tests/
└── cli/wiki.test.ts                 # 进程级 e2e：init→build→status→改文件→update→query 全链路
```

**Structure Decision**: 遵循 roadmap M2 的 wiki 四组件划分
（generator / updater / index / validator），落位 `packages/repository/
src/wiki/`（roadmap 最终结构中 wiki 是 repository 的子目录）；format /
types / git / status / query 为四组件的共享基础设施。core 与 M1 代码
零改动；cli 仅新增 wiki 命令注册。

## Complexity Tracking

> 无宪法违规需要辩护，本表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
