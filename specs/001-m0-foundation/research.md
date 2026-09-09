# Research: M0 Foundation

**Date**: 2026-09-09 | **Status**: 全部 NEEDS CLARIFICATION 已解决

技术栈大框架由宪法 Architecture Constraints 固定（TS / Node 24 /
pnpm / tsup / Vitest / Zod / execa / yaml），无未决项。以下为宪法
未固定、需要在 M0 内拍板的实现级决策。

## D1 — CLI 框架

- **Decision**: commander
- **Rationale**: 子命令树（doctor / 未来 wiki、run、status）+ 全局
  flag（--json）+ 版本号是一等公民；生态最大、文档全、零魔法，符合
  宪法原则 VI（复用而非自研）。
- **Alternatives considered**:
  - `cac`：更轻，但子命令与类型推导较弱
  - `clipanion`：类 DI 风格，学习成本高，社区小
  - 原生 `util.parseArgs`：无子命令树，fleet 后续命令多，不够用

## D2 — Lint / Format 工具

- **Decision**: ESLint（flat config）+ Prettier
- **Rationale**: typescript-eslint 规则集最全；与 Vitest / tsup 生态
  默认集成度高；单人项目无格式争议，Prettier 默认即可。质量门 =
  `lint`（ESLint）+ `format:check`（Prettier）。
- **Alternatives considered**:
  - Biome：单一工具更快的方案，但插件/规则生态仍小于 ESLint，
    且引入第二套语义；作为未来迁移候选保留

## D3 — Monorepo 测试布局

- **Decision**: Vitest projects（根 `vitest.workspace.ts` 统一编排）
- **Rationale**: `pnpm test` 一条命令覆盖全部子包（FR-001/FR-002）；
  根 `tests/cli/` 承载进程级 e2e（execa 拉起真实 bin，验证退出码与
  输出），与单元测试同门禁。
- **Alternatives considered**:
  - 每包独立 vitest 配置 + pnpm -r 递归：输出分散、失败定位差

## D4 — Node 最低版本的真源

- **Decision**: 根 `package.json` 的 `engines.node` 为唯一真源；
  doctor 读取 engines 并用 semver 与 `process.version` 做满足性检查
- **Rationale**: 版本要求只写一处，避免 doctor 硬编码与实际声明
  漂移（宪法原则 I 的"配置即真源"精神）。
- **Alternatives considered**:
  - doctor 内硬编码版本号：两处维护，必然漂移

## D5 — 配置文件位置与格式

- **Decision**: `configs/fleet.yaml`（YAML，遵循 roadmap §11 结构）；
  子目录运行时向上查找仓库根再定位配置（覆盖 spec 边界情况）
- **Rationale**: roadmap 已给出目标目录形态，遵循之；YAML 在技术栈
  内已有依赖（yaml 包）。
- **Alternatives considered**:
  - 仓库根 `fleet.yaml`：更显眼，但偏离 roadmap 基线
  - JSON：无注释，人写配置体验差

## D6 — ID 生成

- **Decision**: `crypto.randomUUID()` + 语义前缀（如 `evt_`、`run_`），
  零新增依赖
- **Rationale**: 内置、稳定、全局唯一（FR 语境足够）；前缀保证人可
  读可辨识。符合宪法原则 VI。
- **Alternatives considered**:
  - nanoid：更短，但多一个依赖且无排序价值
  - ULID：时间有序，M0 无排序需求，需要时再引入

## D7 — 构建策略

- **Decision**: 每个包用 tsup 出 `dist`（ESM + CJS + dts）；根
  `pnpm build` 串行构建；CLI bin 由 tsup bundle
- **Rationale**: Vitest 直接测源码不受构建影响；bin 不依赖 tsx 运行
  时；包间通过 workspace 协议消费 dist，为 M1+ 增量加包提供可复制
  模板。
- **Alternatives considered**:
  - 仅 cli 打包、core 以 TS 源直出：少一步构建，但 exports 语义
    特殊，后续包复制模板时口径不一

## 探测语义（无争议项，直接记录）

- CodeGraph / Agent Runtime 探测 = 可执行命令存在性检查（which 风格，
  execa 实现）；health 调用是 M1 的 adapter 职责，M0 不做。
- doctor 检查不 fail-fast：跑完全部检查项再汇总决定退出码（利于
  一次性看清所有问题）。
- 退出码约定：0 = 无 error；1 = 存在 error；2 = 用法错误。
