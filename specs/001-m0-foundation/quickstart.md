# Quickstart: M0 Foundation 验证指南

**Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

从零验证 M0 端到端可用的操作手册。命令契约见
[contracts/cli.md](contracts/cli.md)，配置契约见
[contracts/fleet-yaml.md](contracts/fleet-yaml.md)。

## 前置条件

- Node.js ≥ 24（`node -v` 确认）
- pnpm（`corepack enable` 或独立安装）
- git

## 安装与质量门（US1 / FR-001 / FR-002）

```bash
pnpm install          # 安装全部 workspace 依赖
pnpm build            # 构建全部包（core → cli）
pnpm check            # lint + format 检查 + 全部测试，一条命令
```

**预期**: `pnpm check` 全绿退出码 0，输出覆盖所有子包的测试结果；
总时长满足 SC-001（全新环境克隆到全绿 ≤ 10 分钟）。

**反向验证**: 在任意源文件引入一个 lint 违规（如未使用变量）再跑
`pnpm check` → 非零退出码，输出逐条定位文件与行号。

## fleet doctor（US2 / FR-003~005 / FR-011）

```bash
pnpm fleet doctor            # 人类可读
pnpm fleet doctor --json     # 结构化（jq .ready 验证可解析）
pnpm fleet --version
```

**健康环境预期**: 六项检查中前四项 ✓；codegraph / agent-runtimes
视本机安装情况 ✓ 或 ⚠；`ready: true`，退出码 0，耗时 ≤ 5 秒
（SC-002）。

## 故障注入验证（SC-003 五类）

| # | 故障 | 操作 | 预期 |
|---|------|------|------|
| 1 | 低版本 Node | 单元/组件测试注入版本比较用例（模拟 engines 不满足） | `node-version` error + 修复建议 |
| 2 | git 缺失 | 组件测试中模拟 git 探测失败 | `git-available` error + 建议 |
| 3 | 非 git 目录 | `cd /tmp && pnpm --dir <repo> fleet doctor`，或将 CLI 在无 .git 目录运行 | `git-repo` error + 建议 |
| 4 | 配置缺失 | 临时改名 `configs/fleet.yaml` | `fleet-config` error（CONFIG_MISSING）+ 建议 |
| 5 | 字段非法 | 临时写入 `version: 2` 或 `defaults: {retry: -1}` | `fleet-config` error，逐字段指出 path/expected/received |

每类注入后恢复现场并复跑健康路径确认回归绿色。#4/#5 可手工执行，
#1/#2 由自动化测试覆盖（测试即验收证据）。

## core 基础能力抽检（US3 / FR-006）

以下断言包含在 `pnpm check` 的测试套件中，此处为人工核对口径：

- 合法 `fleet.yaml` 样例 → 结构化配置对象；非法样例 →
  FleetError（CONFIG_INVALID）且 context.issues 逐字段。
- ID：`evt_` 前缀 + UUID，两次生成不同。
- Git 检测：仓库目录返回根路径；普通目录返回 NOT_A_GIT_REPO。
- 文件系统抽象：同一逻辑在内存实现下通过（不触碰真实磁盘）。

## 完成判定

以上全部通过 = M0 验收（roadmap M0：`pnpm test` + `fleet doctor`
达标；宪法合规见 plan.md Constitution Check）。
