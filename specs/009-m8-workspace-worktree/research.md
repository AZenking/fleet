# Research: M8 Workspace + Git Worktree

**Date**: 2026-09-11 | **Status**: 技术决策已定

关键输入：M7 权限矩阵（runtime 单一来源）与 AgentTaskExecutor、
M5 批次屏障调度（并行写任务的时序基线）、M0 的 execa 受控子进程
模式、根 .gitignore 已含 `.fleet/`。

## D1 — 包边界与矩阵复用

- **Decision**: `packages/workspace` 依赖 core + runtime + mission
  + scheduler；写授权判定直接用 `ROLE_PERMISSIONS`（runtime 单一
  来源）——workspace 不持有第二份矩阵。
- **Rationale**: 宪法 II 单一来源；M7 已把矩阵下沉 runtime，
  workspace 作为消费方零复制。
- **Alternatives considered**: 矩阵再导出到 workspace（第二事实源，
  漂移风险）。

## D2 — worktree 命名与并发安全

- **Decision**: 分支 `fleet/<runShort>/<taskId>`、目录
  `.fleet/worktrees/<runShort>-<taskId>`（runShort = runId 去前缀
  截短 8 位 + 校验位思路——同 run 内 taskId 唯一（M4 保证）→
  同 run 零碰撞；跨 run 用 runShort 区分）。create 前显式查分支
  已存在 → `branch_collision`（区分：目录存在但不在活动清单 →
  孤儿候选提示；都不在 → 真活动冲突）。
- **Rationale**: 命名可追溯（任务 ↔ 分支 ↔ 目录一眼对应）；
  碰撞检测显式化而非依赖 git 报错字符串。
- **Alternatives considered**: 全 uuid 目录（可读性差、孤儿排查
  困难）；仅 taskId（跨 run 必撞）。

## D3 — git 序列与受控子进程

- **Decision**: `git.ts` 统一封装（execa，超时 5s，非零退出 →
  结构化 WorkspaceFault，stderr 首行进 detail）。各操作序列：
  - **create**：`rev-parse --is-inside-work-tree` → `rev-parse
    HEAD`（空仓拒绝）→ `status --porcelain`（dirty 拒绝）→
    `branch --list <branch>`（碰撞）→ 活动上限 → `worktree add
    -b <branch> <path> HEAD`
  - **getDiff**：`add -A -N`（intent-to-add——未跟踪文件进 diff
    的标准做法，仅动隔离区 index）→ `diff HEAD`；二进制由 git
    输出 `Binary files ... differ` 天然标注
  - **merge**：隔离区 `add -A` → `commit -m "fleet: <taskId>"`
    （nothing-to-commit → noop）→ 主仓 `merge --no-ff <branch>`
    （冲突 → 解析 `CONFLICT` 行得文件清单 → `merge --abort`
    双方回 pre-merge → conflict 结果）；成功 → `rev-parse HEAD`
    作 merged 提交号
  - **destroy**：`worktree remove --force` → `branch -D`；任一步
    失败 → `cleanup_partial` + 残留项清单；资源已不存在 → 幂等
    成功
- **Rationale**: 全序列只读主仓（除 merge/分支删除）；每个 git
  调用独立超时防挂。
- **Alternatives considered**: libgit2 绑定（新依赖，违宪 VI）；
  `git -C` 散落各处（超时与错误语义不一致）。

## D4 — 孤儿检测语义（M11 前的最小集）

- **Decision**: 真相源 = `git worktree list --porcelain`（跨进程）；
  孤儿 = 路径在 `.fleet/worktrees/` 下 **且不在本管理器活动
  Map**。`inventory()` 返回 { active, orphans }；
  `cleanupOrphan(orphan)` = destroy 同序列。进程崩溃后的"无人
  认领"检测属 M11（需要 run 注册表）；M8 保证：同进程内管理器
  销毁后清单归零 + 跨进程 list 可枚举 + 清理原语可用。
- **Rationale**: spec FR-008 的"可检测可列出可最小清理"精确
  落地，不越 M11 边界。
- **Alternatives considered**: 心跳文件 / 锁文件（跨进程所有权
  判定——M11 范围，提前做会被 Recovery 真实需求推翻）。

## D5 — run 集成：per-task cwd 解析 + 处置装饰器

- **Decision**: 两件小扩展 + 一个装饰器：
  1. **AgentTaskExecutor**（agents 包，向后兼容）：`config.cwd`
     扩展为 `string | ((task: Task) => string)`——构造请求时
     resolve；
  2. **FakeRuntimeAdapter**（runtime 包）：构造选项
     `touchOnSuccess?: string[]`——成功路径在 cwd 写文件（单测
     替身写行为）；
  3. **WorkspaceResolvingExecutor**（workspace 包，装饰
     TaskExecutor）：execute(task) → 写授权角色 → create worktree
     → 内层 executor（cwd resolver 查表）→ 按结果处置（成功
     merge / 失败 destroy，策略可配 `keep-on-finish`）→ 处置
     记录；只读角色直接内层（主仓根）。
  CLI：`fleet run` 默认装配 worktree 集成，`--no-worktree` 回退
  M7 行为；RunReport 增可选 `workspaces: [{taskId, action,
  outcome, detail?}]`（runner duck-typing 读取装饰器的记录面）。
- **Rationale**: 装饰器保持 M7 执行器职责不膨胀；处置策略集中
  一处；`--no-worktree` 给快速试跑与对照测试留门。
- **Alternatives considered**: 改 scheduler 在派发前建区（调度器
  知道工作区——职责倒挂）；每任务子进程级 chdir（不跨请求）。

## D6 — 串行依赖的基线继承（US2 场景 5）

- **Decision**: M5 批次屏障天然保证：A 批完成（含 merge）后 B
  才派发——B 的 create 以主仓当前 HEAD 为基线，自动含 A 的已
  合并变更。断言即可，无需额外机制。
- **Rationale**: 批次屏障（M6 D4）在此兑现第二重红利。

## D7 — 主仓干净采样（SC-002）

- **Decision**: e2e 中双写任务并行期间以 50ms 间隔轮询主仓
  `git status --porcelain`（空 = 干净），结束断言采样全干净 +
  双 worktree diff 互不可见（A 看不到 B 的文件）+ 双 merge 后
  主分支两文件并存。
- **Rationale**: "全程干净"的持续断言而非仅终态；轮询在并行
  Promise 内自然运行。

## D8 — 测试策略

- **Decision**: 三层：
  1. **单元（workspace 包）**：tmp git 夹具（beforeAll 建仓 +
     基线提交）驱动 GitWorktreeManager——生命周期全链、六类
     故障注入（dirty 主仓 / 残留分支 / 空仓 / 非仓 / 清理失败
     mock 目录删除 / 上限）、merge 冲突（主仓同位置改）、
     noop、二进制 diff、孤儿检测与清理、幂等 destroy；
  2. **集成（workspace 包）**：WorkspaceResolvingExecutor +
     Fake touchOnSuccess——写角色得 worktree cwd、只读角色主仓
     根（请求流断言 SC-005）、成功 merge / 失败 destroy、
     keep-on-finish 策略；
  3. **e2e（tests/cli/workspace.test.ts）**：tmp 仓库 +
     `write-cli.sh` 替身（PATH 注入）——`fleet run` 双 reason
     并行（SC-002 三段式 + 主仓干净轮询）、`--no-worktree` 回退
     行为、run 中故障（worktree 上限触发 / 冲突任务）不击穿
     run、报告 workspaces 字段。
- **Rationale**: 真实 git 行为只能真进程验证；本仓库零触碰
  （全部 tmp）；替身 CLI 承担写动作（不依赖真实 LLM）。
- **Alternatives considered**: mock git 输出（worktree 行为是
  被测对象本身，mock 即自欺）。

## D9 — 故障注入手段

- **Decision**: dirty = 基线提交后主仓追加未提交文件；残留分支
  = 预先 `git branch fleet/...`；空仓 = git init 后不提交；非仓
  = mkdtemp 空目录；清理失败 = monkey-patch fs（vitest vi.spyOn
  模拟 unlink 失败）或只读目录权限（chmod 555 父目录）；冲突 =
  主仓与 worktree 同行修改；上限 = 配置 maxWorktrees=1 后第二个
  create。
- **Rationale**: 每类故障独立可控可重复。

## D10 — 性能与上限

- **Decision**: git 子命令超时 5s；活动 worktree 上限默认 8
  （构造可配，超限 `limit_exceeded`）；`.fleet/worktrees/` 已被
  根 .gitignore 覆盖（M0 的 `.fleet/` 行）——主仓 status 天然
  不含 worktree 目录。
