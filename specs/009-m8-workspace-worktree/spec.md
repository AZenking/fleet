# Feature Specification: M8 Workspace + Git Worktree（物理工作区隔离）

**Feature Branch**: `009-m8-workspace-worktree`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "继续" — 对应 `agent-fleet-roadmap.md`
Phase C / M8：实现 WorkspaceManager（create / getDiff / merge /
destroy）与 GitWorktreeManager；多个 Reason 并行执行时各自获得
隔离 Git Worktree——**不污染主 Workspace，也不互相污染**（验收
锚点）。M7 的请求级权限声明至此获得物理强制层（宪法 II）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 工作区生命周期 (Priority: P1)

作为 Fleet 开发者，我为一个任务申请隔离工作区：
`create(taskId)` 在 `.fleet/worktrees/` 下创建 Git Worktree（含
独立分支，命名可追溯任务）；任务在其中自由写入；`getDiff`
返回该工作区相对基线的完整 diff；`merge` 把变更合回主分支
（冲突时不强合，结构化报告冲突文件）；`destroy` 清理 worktree
与分支。生命周期的每一步幂等可查（状态可观测）。

**Why this priority**: WorkspaceManager 是 M7 权限的物理落点与
M9 Validation 的前置（diff 是验证的输入）——没有隔离工作区，
"Reason 唯一深写 + 并行不污染"只是声明。

**Independent Test**: tmp git 仓库上：create → 写文件 → getDiff
含该变更 → merge 后主分支可见 → destroy 后 worktree 目录与
分支消失、主仓干净。

**Acceptance Scenarios**:

1. **Given** 一个 git 仓库与任务 id，**When** create(taskId)，
   **Then** `.fleet/worktrees/<可追溯路径>` 存在、独立分支已建、
   基线 = 主分支当前 HEAD；返回的 Workspace 含路径 / 分支 /
   状态。
2. **Given** 工作区内的文件修改，**When** getDiff，**Then**
   返回标准 unified diff（仅含该工作区的变更）。
3. **Given** 无冲突的变更，**When** merge，**Then** 主分支获得
   变更（提交可见），merge 结果结构化（merged + 提交号）。
4. **Given** 冲突变更（主分支同位置已改），**When** merge，
   **Then** **不强合**——返回 conflict 结果 + 冲突文件清单，
   工作区与主分支保持 merge 前状态（可重试或 destroy）。
5. **Given** 已 merge 或已废弃的工作区，**When** destroy，
   **Then** worktree 目录删除、分支清理；对已不存在资源的
   destroy 幂等（不报错）。

---

### User Story 2 - 并行隔离（验收锚点） (Priority: P2)

作为 `fleet run` 的使用者，mission 含多个无依赖的 reason 任务
（或 reason × reflex 混合）时：**每个写授权任务（reason / reflex）
在自己的 worktree 中执行**——运行时请求的 cwd 即该 worktree；
**只读角色（focus / insight / wisdom）在主仓根执行**。并行执行
结束后：主工作区全程零变更（除显式 merge）；各任务的变更只
存在于各自 worktree；任务之间互不可见对方的未合并变更。

**Why this priority**: roadmap M8 验收锚点原文——"多个 Reason
并行执行时不能污染主 Workspace，也不能互相污染"；这是 Fleet
从"串行安全"到"并行安全"的分水岭。

**Independent Test**: tmp git 仓库 + 双 reason 无依赖任务的
mission：并行执行（替身运行时写不同文件）→ 主仓 git status
干净；两个 worktree 各含各自变更且互不可见；分别 merge 后
主分支两者兼得。

**Acceptance Scenarios**:

1. **Given** 两个无依赖 reason 任务，**When** fleet run 并行
   执行，**Then** 各自 worktree 创建、变更互不可见、主仓
   `git status` 全程干净。
2. **Given** focus / insight / wisdom 角色的任务，**When**
   执行，**Then** 其运行时请求 cwd = 主仓根（只读角色不占
   worktree——物理范围最小化）。
3. **Given** reason 任务执行失败或被跳过，**When** run 结束，
   **Then** 其 worktree 仍被清理（生命周期绑定 run，不泄漏）。
4. **Given** 任务成功但未显式合并策略（M8 默认：成功即合 /
   失败即弃——策略可关），**When** run 完成，**Then** 成功任务
   的变更按默认策略合入主分支，失败任务的 worktree 销毁。
5. **Given** 依赖链中的任务（A→B），**When** B 在 A merge 后
   创建工作区，**Then** B 的基线包含 A 的变更（串行依赖不
   丢失上游成果）。

---

### User Story 3 - 故障矩阵与恢复语义 (Priority: P3)

作为 Fleet 运维者，工作区子系统在故障下的行为可预期：
**merge conflict**（冲突结构化报告、不强合）；**dirty
workspace**（主仓有未提交变更时 create / merge 的语义明确）；
**branch collision**（同名分支已存在——任务 id 冲突或残留）；
**orphan worktree**（进程崩溃后的残留——可检测、可列出、
可清理）；**cleanup failure**（destroy 部分失败——报告残留、
不静默假装成功）。

**Why this priority**: roadmap M8 明确的六类必处理故障；进程
崩溃与孤儿是长期运行系统的必然，恢复属 M11 但**检测与最小
清理**必须现在可用。

**Independent Test**: 故障注入矩阵——主仓 dirty、残留同名分支、
手工制造孤儿 worktree（跳过 destroy）、mock 清理失败——每类
产生结构化结果（code + detail），零崩溃。

**Acceptance Scenarios**:

1. **Given** 主仓有未提交变更，**When** create，**Then** 明确
   语义（拒绝并提示先提交/储藏，或声明基于当前工作树——M8
   取拒绝：基线必须干净可复现）。
2. **Given** 同名分支已存在（残留），**When** create，**Then**
   branch collision 报告（区分"残留可清理"与"活动冲突"）。
3. **Given** 进程崩溃后残留的 worktree（无持有者），**When**
   检测 / 列出，**Then** 孤儿可识别（与活动 worktree 区分），
   提供最小清理入口（库层）。
4. **Given** destroy 的某步失败（目录删除失败 / 分支删除被
   拒），**When** destroy，**Then** cleanup failure 结构化报告
   残留项；后续再次 destroy 可重试（幂等语义）。
5. **Given** 上述任一故障，**When** 发生在 fleet run 过程中，
   **Then** 对应任务按 M5 语义失败 / 跳过，run 不崩溃，故障
   进入报告。

---

### Edge Cases

- 空 diff 的 merge（任务什么都没改）：合法——merge 为空操作，
  结果标注 no-op（不算失败）。
- 二进制文件 diff：getDiff 标注 binary（不输出乱码）。
- 仓库无任何提交（空仓）：create 拒绝（无基线可隔离）。
- 非 git 仓库目标：create 明确报错（M8 仅支持 git worktree）。
- worktree 内新文件未 add：getDiff 用包含未跟踪文件的语义
  （隔离区的"工作树状态"即变更），merge 前 add。
- 同一 run 内 reflex（轻写）与 reason（深写）并存：各自独立
  worktree（都是写授权）。
- 主分支在任务执行期间前移（他人提交）：merge 时正常 git
  语义（可 fast-forward / 或冲突走 US3 场景 4）。
- `.fleet/worktrees/` 自身不进主仓 git（忽略或排除）。
- 大量并行 worktree：目录命名含 runId + taskId 防碰撞，
  上限保护（默认如 8 个活动 worktree，超出排队或拒绝——M8
  取拒绝并报告）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: WorkspaceManager 接口 MUST 提供
  create(taskId) / getDiff(workspace) / merge(workspace) /
  destroy(workspace)；实现为 GitWorktreeManager（git worktree
  子进程操作，复用 execa 模式）。
- **FR-002**: create MUST：校验目标为干净基线的 git 仓库
  （dirty / 非仓库 / 空仓 → 结构化拒绝）；在 `.fleet/worktrees/`
  下创建带独立分支的 worktree（命名含 runId + taskId，可追溯）；
  返回 Workspace 实体（路径 / 分支 / 基线提交 / 状态）。
- **FR-003**: getDiff MUST 返回 unified diff，含未跟踪新文件
  的语义；二进制文件标注；只含该工作区变更。
- **FR-004**: merge MUST 不强合：冲突时返回 conflict + 冲突
  文件清单，双方状态保持 pre-merge；成功返回 merged + 提交
  号；空 diff 返回 no-op。
- **FR-005**: destroy MUST 清理 worktree 目录与分支，幂等；
  部分失败 → 结构化报告残留（不静默成功）。
- **FR-006**: `fleet run` 集成 MUST：写授权角色（reason /
  reflex）的任务在专属 worktree 执行（运行时请求 cwd = worktree
  路径）；只读角色在主仓根执行；run 结束按默认策略处置
  （成功合入 / 失败销毁；策略可关闭——报告 worktree 留待人工）。
- **FR-007**: 并行隔离 MUST 成立：多写任务并行时主仓
  `git status` 全程干净、worktree 间互不可见未合并变更；
  串行依赖链的后继工作区基线含上游已合并变更。
- **FR-008**: 故障矩阵（conflict / dirty / branch collision /
  orphan / cleanup failure）MUST 结构化结果（code + detail），
  零崩溃；孤儿 worktree 可检测、可列出、可最小清理（库层）。
- **FR-009**: worktree 数量上限（默认 8）MUST 强制，超出
  结构化拒绝。
- **FR-010**: `.fleet/worktrees/` MUST 不污染主仓（忽略 /
  排除语义）；worktree 操作全部只读主仓（除显式 merge）。
- **FR-011**: 集成断言 MUST 以替身运行时驱动（写文件的替身
  CLI / Fake 写路径注入）；e2e 在 tmp git 仓库执行，不触碰
  本仓库工作区。

### Key Entities

- **Workspace**: taskId、runId、路径、分支名、基线提交、状态
  （active / merged / conflict / destroyed / orphaned）。
- **WorkspaceManager（接口）**: create / getDiff / merge /
  destroy（roadmap 签名）。
- **MergeOutcome**: `merged {commit}` | `conflict {files}` |
  `noop` | `rejected {reason}`。
- **WorkspaceFault**: code（dirty_main / branch_collision /
  cleanup_partial / not_a_git_repo / empty_repo / limit_exceeded /
  orphan_detected）+ detail。
- **WorkspaceInventory**: 活动 / 孤儿 worktree 清单（检测与
  最小清理入口）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 生命周期链（create→写→diff→merge→destroy）在
  tmp 仓库全绿；merge 后主分支含变更、destroy 后零残留。
- **SC-002**: 双 reason 并行（替身写入）：主仓全程 `git
  status` 干净（轮询采样断言）、两 worktree 变更互不可见、
  双 merge 后主分支两者兼得——验收锚点操作化。
- **SC-003**: 六类故障注入 100% 结构化结果（code 可断言）、
  0 崩溃、0 主仓污染。
- **SC-004**: 孤儿 worktree：崩溃残留可检测（与活动区分）、
  最小清理后清单归零。
- **SC-005**: 只读角色请求 cwd = 主仓根、写角色 cwd = worktree
  路径（请求流断言 100%）。
- **SC-006**: 故障发生在 run 中：任务级失败 / 跳过语义与 M5
  一致，run 报告含故障明细。

## Assumptions

- M8 仅支持 git 仓库（git worktree 机制）；其他 VCS 不在
  范围。
- merge 目标分支 = 主分支（当前 checked-out 的主干，默认
  main / master 自动识别）；多目标分支策略属后续（M12
  Control Center 配置面）。
- "成功即合 / 失败即弃"是 M8 默认策略且可整体关闭（保留
  worktree 供人工处置）；基于 diff 的验证门（Validation
  Runner 决定 merge/reject）是 M9——M8 的 merge 是显式调用，
  run 集成只是默认策略的一种调用方。
- 主仓 dirty 判定 = `git status --porcelain` 非空即拒绝
  （基线可复现优先；stash 自动化不做——用户先处理）。
- 孤儿检测 = worktree 目录存在但不在管理器活动清单（进程内）
  / 或 `.fleet/worktrees/` 下无对应活动 run——完整跨进程恢复
  属 M11（M8 提供清单 + 清理原语）。
- 落位 `packages/workspace`（roadmap 最终结构）；依赖 core
  + mission（角色权限判定复用 M7 policy）+ scheduler（任务
  执行器接缝）。
- 替身运行时执行"写文件"动作：FakeRuntimeAdapter 增加可注入
  写行为（或替身 CLI echo > file）——测试可控，不引入真实
  LLM 依赖。
- 零新增第三方依赖；无新 CLI 命令（库 + fleet run 集成；
  工作区巡检 CLI 属 M11）。
