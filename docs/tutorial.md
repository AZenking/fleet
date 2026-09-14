# Fleet 使用教程

> 从零到用真实 Agent 跑完一个多任务 mission。本文所有输出均为真实运行截取。
> 前置阅读：`README.md`（一页纸总览）· 治理：`.specify/memory/constitution.md`

## 0. Fleet 是什么（30 秒）

你把一个软件任务写成 **mission**（YAML：目标 + 任务 DAG + 验收标准），Fleet 派五个
角色的 Agent（Reflex/Focus/Reason/Insight/Wisdom）去干：写代码的 Agent 在各自的
**隔离 Git Worktree** 里干活互不污染，干完由**独立的 Validation Runner** 跑
lint/typecheck/tests（实现者自己说"测试过了"不算数），再由 Wisdom 审阅，通过才
合回主分支。全程事件落盘，崩了能续跑。

## 1. 准备

```bash
pnpm install
pnpm build          # CLI 从 dist 启动，改代码后也要重跑
pnpm fleet doctor   # 环境体检（可选）
```

下文用 `pnpm fleet` 调用 CLI（根 package.json 的快捷脚本）。

## 2. 五分钟跑通第一个 mission

仓库里有活样例 `missions/demo.yaml`。先校验：

```bash
pnpm fleet mission validate missions/demo.yaml
```

试跑一次（Fake 运行时 + 关验证门——纯走通管线）：

```bash
pnpm fleet run missions/demo.yaml --no-validation-gate
```

真实输出：

```text
▶ mission demo-mission · 2 任务 · fake 运行时
  任务表：
    define-schema        reason   completed  1 次
    wire-cli             reason   completed  1 次
  预算：0 in / 0 out tokens · 2 次执行 · 上下文节省 0%
  工作区：
    define-schema        merged（noop）
    wire-cli             merged（noop）
✓ mission completed · 总耗时 2181ms · runId run_a8ae635d…
```

`merged（noop）` 是因为 Fake 什么都没写（空 diff，合法）。跑完看一眼家底：

```bash
pnpm fleet ps
```

```text
demo-mission         a8ae635d-2c      completed    2✓ 0✗ 0↷ 0⏸ 0…   2026-09-12T09:35:43Z
```

## 3. 理解刚才发生了什么

```text
fleet run
 ├─ 校验 mission（不过=零执行）
 ├─ DAG 调度（固定并发 3、重试 1——确定性内核，无 LLM 决策）
 ├─ 每个写任务 → 独立 worktree（.fleet/worktrees/）── 主仓全程干净
 ├─ 任务完成 → Validation Runner 独立跑 diff/lint/typecheck/tests
 ├─ 验证过 → Wisdom 审阅：approved / changes_requested（→ 修复重验，最多 2 轮）
 ├─ 双过 → merge 回主分支；否则 worktree 销毁，零合并
 └─ 全程事件流式落盘 .fleet/runs/<mission>/<run>/
```

五角色分工：`focus` 只读调查 → `reason` 唯一深度写者 → `insight` 只读取证 →
`wisdom` 只读审阅 → `reflex` 轻量琐事。权限是**系统强制的**（env 声明 + worktree
物理隔离），不靠 prompt 自觉。

## 4. 写你自己的 mission

复制 `missions/demo.yaml` 改：

```yaml
id: add-export
goal: 给 CLI 增加 fleet export 命令
planningMode: execution # 方案已确认模式（Codex Desktop 讨论定案后用）

requirements:
  - text: 把 run 报告导出为 JSON 文件

plan: { summary: 新增子命令，读 .fleet/runs 渲染 } # execution 模式必填

tasks:
  - id: probe
    goal: 调查 .fleet/runs 落盘结构
    agentRole: focus
    dependsOn: []
  - id: build
    goal: 实现 fleet export 命令与测试
    agentRole: reason
    dependsOn: [probe]

validation: # 验证门（可选；缺省自动探测 package.json scripts）
  commands:
    tests: pnpm test
maxReviewLoops: 2 # 审阅修复上限（宪法默认 2）

acceptance:
  - given: 存在已完成的 run
    when: fleet export <mission>
    then: 生成 JSON 报告
```

## 5. 接入真实 Agent

**方式一：内置适配器**（`pi` / `codex` / `gemini`，装好 CLI 即用）：

```bash
pnpm fleet run m.yaml --runtime reason=pi          # 只有 reason 用 pi
pnpm fleet run m.yaml --runtime pi                  # 全角色
pnpm fleet run m.yaml --runtime reason=pi --runtime wisdom=gemini
```

适配器自动：非交互执行 + 权限翻译进提示词 + codex 按角色切 sandbox。显式指定的
运行时会先探测，不可用直接报错——**不会静默降级成 Fake**。

**方式二：任意 PATH 上的 CLI**（零代码）。约定：`<你的CLI> "<prompt全文>"`、
退出码 0=成功、在 cwd（自动是 worktree）里干活、可选输出一行
`FLEET_USAGE {"inputTokens":..,"outputTokens":..,"cachedTokens":..}` 上报用量。

**方式三：程序化**——实现 `RuntimeAdapter`（execute + cancel，四条合同：异常不
逃逸/超时诚实/cancel 单次 settle/清理完备）后 `registerRuntimeFactory('名', 工厂)`。

## 6. 验证门：一个你必须知道的首跑现象

直接 `pnpm fleet run missions/demo.yaml`（Fake + 门开）会**失败**——这是特性不是
bug。真实输出：

```text
    define-schema        reason   failed  1 次  review_error：审阅失败
                            （fail-closed，verdict_unparseable）
  验证门：
    define-schema        review_error · 修复 0/2 轮 · 末次审阅 —
✗ mission failed
```

原因：Fake 的 wisdom 说不出可解析的裁决，而宪法 III 规定**审阅者缺席宁可失败也
不放行**。所以三种姿势按需选：

| 场景             | 做法                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| 只想走通管线     | `--no-validation-gate`                                                                   |
| 真实跑           | `--runtime wisdom=pi`（或其他真实 CLI）                                                  |
| 自建 wisdom 替身 | CLI 输出 `{"verdict":"approved","comments":"…"}` 或裸行 `approved` / `changes_requested` |

Wisdom 的输出约定就这三样，解析失败一律 fail-closed。

## 7. 观察与运维

```bash
pnpm fleet ps                        # 全部 run（含中断态）
pnpm fleet status demo-mission       # 任务分布 + 摘要
pnpm fleet logs demo-mission --type task.   # 事件时间线（前缀过滤）
pnpm fleet inspect demo-mission      # 完整报告 JSON
pnpm fleet diff demo-mission         # 本次合入的变更面
```

`status` 真实输出：

```text
▶ demo-mission · completed · 2026-09-12T09:35:43Z
    define-schema        completed
    wire-cli             completed
  摘要：completed · 任务 2 · 累计执行 2 次
```

## 8. 取消与断点续跑

```bash
pnpm fleet cancel demo-mission     # 取消进行中 run（批次屏障生效，未开始任务跳过）
pnpm fleet run m.yaml --resume     # 续跑：事件流里已完成的任务零重跑
pnpm fleet ps --orphans            # 崩溃残留（worktree/进程）报告
pnpm fleet clean --force           # 清理孤儿
```

--resume 的保护：mission 任务集改过（指纹漂移）会**拒绝续跑**并提示全新跑。

## 9. Repository Intelligence（可独立使用）

```bash
pnpm fleet repo investigate "ValidationRunner 在哪被调用"
pnpm fleet wiki init && pnpm fleet wiki build
pnpm fleet wiki query "验证门的语义"
```

CodeGraph/wiki 挂了只降级到原生搜索，调查不会失败（宪法 I）。

## 10. MCP：把 Fleet 接进 Codex Desktop

Codex Desktop 的 MCP 配置里加两条：

```json
{
  "mcpServers": {
    "fleet-repo": { "command": "pnpm", "args": ["fleet", "mcp", "repo"] },
    "fleet": { "command": "pnpm", "args": ["fleet", "mcp", "fleet"] }
  }
}
```

然后在桌面端直接走完整工作流：讨论需求 → `fleet_create_mission`（定案落盘）→
`fleet_run` → `fleet_result`（拿 Review Package 做最终审阅）。Fleet 不反向依赖
桌面端。

## 11. 常见问题

**worktree 创建失败（dirty_main）**——主仓有未提交变更时拒绝建区（基线必须可复
现）。先 commit 或 stash。

**验证命令在 worktree 里找不到依赖**——worktree 不带 node_modules。轻量命令开箱
即用；Node 项目把验证命令写成先装依赖（`pnpm install && pnpm test`，慢），或本仓
自用时临时 `--no-validation-gate`。

**退出码**——0：completed（cancelled 也算 0，用户意图）；1：任务失败/校验拒绝；
2：用法错误。

**Token 统计是 0**——运行时没上报 usage（measured=false 不伪造）。自建 CLI 加
一行 FLEET_USAGE 输出即可。

**事件流在 stderr**——默认 debug 事件打 stderr（`2>/dev/null` 清屏），stdout 干净
可管道。

**CodeGraph 索引过期（stale）**——缺省 Fleet 只降级到搜索并建议你手动
`codegraph sync`。想让它自动维护，在 configs/fleet.yaml 配置：

```yaml
codegraph:
  autoMaintain: sync # stale 时自动一次 codegraph sync
  # autoMaintain: auto # 更进一步：未建索引时自动 init（首次建索引可能分钟级）
```

或单次覆盖：`fleet repo investigate "问题" --codegraph-maintain sync`。
维护是单次的（一次调查至多一次动作）、失败/超时只降级不影响调查结果，
全程 `codegraph.init/sync.*` 事件可查。
