# Research: M7 五角色 Agent + 真实 Runtime

**Date**: 2026-09-11 | **Status**: 技术决策已定（含本机实测：pi
0.85.1 已装且非交互面干净；codex / gemini 未装）

关键输入：M6 RuntimeAdapter 契约四条款与 bridge/runner、M5
TaskExecutor 端口、M1 cli-adapter 的 execa 子进程模式、宪法 II/IV。

## D1 — 包边界：agents（角色）与 runtime（运行时）分包

- **Decision**: `packages/agents` = 角色定义 + 权限矩阵（单一
  来源）+ 注册表 + 角色解析执行器；`packages/runtime` 扩展 =
  CliRuntimeAdapter 基座 + 三薄适配器 + 探测。依赖单向
  agents → runtime（agents 消费契约与 Fake）。
- **Rationale**: 宪法 II/IV 的结构化表达——角色与运行时是两个
  变化轴；roadmap 最终结构既有 packages/agents 也有
  packages/runtime。
- **Alternatives considered**: 全放 runtime（角色定义混进运行时
  包，变化轴纠缠）；全放 agents（适配器属运行时层，倒挂）。

## D2 — 角色解析执行器：AgentTaskExecutor（M6 bridge 的进化）

- **Decision**: `AgentTaskExecutor implements TaskExecutor`：
  execute(task) → 查角色定义（提示片段 + 权限）→ 注册表解析
  adapter → 构造 RuntimeRequest（runId/agentId/prompt = 角色片段
  + 任务目标 / env: ROLE + PERMISSION / timeout 三档推导同 M6）
  → adapter.execute。记录 requests（含 permission 与 runtime
  名）/ taskTimings / perTaskTimeoutMs——形态对齐 M6 bridge，
  runner 复用报告合成。
- **Rationale**: per-role 运行时解析必须在派发路径上（注册表是
  配置行为）；M6 bridge 保留为 runner 的默认快路径（Fake 全注册
  的等价捷径），向后兼容。
- **Alternatives considered**: 改造 M6 bridge 接受 resolver（桥
  接职责膨胀；两套语义共存于一个类）。

## D3 — 权限强制链路：矩阵 → 请求注入 → 适配器校验

- **Decision**: 三段闭环：
  1. **单一来源**：agents/policy.ts 的 `ROLE_PERMISSIONS` 常量
     （宪法 II 矩阵）+ `assertRequestPermission(request)`；
  2. **请求必达**：AgentTaskExecutor 构造请求时注入
     `env.FLEET_PERMISSION`（executor 不查矩阵即构造 = 类型层
     不可能——permission 必经 policy 取得）；
  3. **适配器侧强制**：CliRuntimeAdapter.execute 入口先
     `assertRequestPermission`——裸请求（env 无 permission）
     直接拒绝执行（FR-006 不可绕过）。Fake 适配器同样校验
     （Fake 也走真实链路，测试才可信）。
- **Rationale**: 宪法 II"仅靠 Prompt 视为违规"的可测试化——
  强制点在适配器入口，任何绕过 executor 的调用方都被拦。
- **Alternatives considered**: decorator 包 adapter（多一层套娃，
  且 Fake 与真实适配器行为面分裂）。

## D4 — CliRuntimeAdapter 基座与进程组 kill

- **Decision**: 共享基座，三适配器只差配置（命令名 + 参数模板
  + 版本探测参数）：
  - 执行：execa 子进程，`stdin: 'ignore'`（交互即超时路径）、
    cwd = request.cwd、prompt 与权限约束按参数模板注入；
  - **timeout / cancel = 进程组终止**：`detached: true` 启动，
    kill 时 `process.kill(-pid, 'SIGKILL')`（组内孙进程同灭，
    防孤儿）；kill 后 settle 对应失败码（timeout/cancelled），
    进程的迟到输出被丢弃（M6 守卫语义复用——基座内部同构
    Fake 的三路竞争 finish）；
  - 输出捕获：stdout（stdout 超限截断标注）+ stderr 首行进
    detail；exit 0 → ok；非零 → error 码（detail = exit code +
    stderr 摘要）；
  - 截断上限 64KB。
- **Rationale**: kill 语义是 M6 四条款的进程版；进程组 kill 是
  "无孤儿"的唯一可靠手段（CLI 常派生子进程）。
- **Alternatives considered**: execa 自带 timeout（只杀直接子进
  程，孙进程成孤儿——真实 CLI 有 node wrapper 即翻车）。

## D5 — 三适配器参数（pi 实测，codex/gemini 校准制）

- **Decision**: pi（本机 0.85.1 实测）：`pi -p --mode text
  --no-session --append-system-prompt "<角色片段+权限约束>"
  -- <prompt>`；codex / gemini 按公开 CLI 形态先落参数模板
  （非交互 + system prompt 注入 + 无会话持久化），**实现期以
  探测 + 首跑校准**，参数错误不影响契约测试（替身矩阵测的是
  基座行为而非具体参数）。
- **Rationale**: spec 约束"权限必达 + 择最大可执行项"——pi 的
  append-system-prompt 即权限约束载体；未装 CLI 的参数细节
  不阻塞架构正确性。
- **Alternatives considered**: 等三个 CLI 全装齐再开发（阻塞，
  且 CI 机器更不可控）。

## D6 — 探测与可用性（doctor 同源）

- **Decision**: `probeRuntime(name)` → RuntimeAvailability
  { name, available, version? }——命令存在 + `--version` 首行
  解析；doctor 的 Agent Runtime 检查项改消费同一探测源（M0 的
  warning 级语义不变，枚举三 CLI + Fake）。
- **Rationale**: FR-005"未安装 + 建议"；doctor 单一探测源防
  两处漂移。
- **Alternatives considered**: 适配器各自探测（重复实现）。

## D7 — fleet run 的运行时选择

- **Decision**: `--runtime <spec>` 可重复；spec = `name`（全体
  角色）或 `role=name`（单角色覆盖）；缺省 `fake`。解析为注册
  表配置；显式指定的真实运行时不可用 → 启动前报错退出（列
  出探测结果与安装建议），**不静默降级 Fake**。registry 缺省
  全 Fake；未注册角色（理论不可能——缺省兜底）仍明确报错。
- **Rationale**: FR-007；渐进采用路径 = 全 fake →
  `--runtime reason=pi` → 逐步替换。
- **Alternatives considered**: 配置文件先行（configs/agents/
  完整形态属 M12；CLI 选项即最小可用面）。

## D8 — 替身脚本测试策略

- **Decision**: `tests/fixtures/fake-clis/`（可执行 sh）：
  `ok.sh`（回显参数→断言 prompt/权限到达 CLI）、`fail.sh`
  （exit 1 + stderr）、`slow.sh`（写 pid 文件 + sleep 300 →
  timeout/cancel kill + 孤儿断言：kill 后轮询 pid 不存在）、
  `big-output.sh`（>64KB → 截断）、`spawner.sh`（派生子进程
  → 进程组 kill 覆盖孙进程）。受控 PATH 注入（M1 模式）。
  真实 pi e2e：探测可用才跑（demo mission 单任务角色注册），
  否则 skip——套件恒绿。
- **Rationale**: kill/孤儿/截断只能真实进程验证；Fake 基线
  e2e 保障确定性（宪法 IV）。
- **Alternatives considered**: 全靠本机 pi（CI 不可复现）。

## D9 — runner 集成（向后兼容）

- **Decision**: runMissionFile 增加 `executor?: TaskExecutor`
  注入点——CLI 在用户指定任何非缺省运行时（或显式角色注册）
  时构造 AgentTaskExecutor 注入；缺省路径保持 M6 bridge +
  Fake（现有测试零改动）。
- **Rationale**: 最小侵入；M6 的 311 测试是回归资产。
- **Alternatives considered**: runner 直接依赖 agents 包
  （runtime→agents 反向依赖，破坏 D1）。

## D10 — 测试策略

- **Decision**: 三层：
  1. **单元（agents 包）**：五角色定义完备性（矩阵对宪法 II
     逐一断言）；注册表（缺省 fake / 覆盖 / 多对一 / 未注册
     报错）；executor（请求字段含 ROLE+PERMISSION+提示片段、
     timeout 三档、记录形态）；
  2. **单元（runtime 包，替身脚本）**：CliRuntimeAdapter 矩阵
     ——成功 / 非零退出 / 超时 kill / cancel kill（毫秒级）/
     进程组无孤儿 / 截断 / 裸请求拒绝 / stdin ignore；
  3. **e2e**：Fake 基线回归不变；替身 PATH 下 `fleet run
     --runtime ok-runtime`（把替身注册为自定义命令名——基座
     支持命令名配置使替身可充当"某真实 CLI"）；pi 真实端到端
     （探测启用，reason=pi 单任务 + 权限到达断言）。
- **Rationale**: SC-001~006 的落点；真实 CLI 缺失不影响套件。
