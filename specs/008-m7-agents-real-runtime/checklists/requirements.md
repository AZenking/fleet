# Specification Quality Checklist: M7 五角色 Agent + 真实 Runtime

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-11
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- 五角色权限矩阵与"权限由系统强制"来自宪法 II 的产品级定义；
  codex / gemini / pi 为 roadmap 点名的真实运行时——非实现
  泄漏。
- 关键边界（FR-010 / Assumptions 钉死）：M7 权限强制 = 请求级
  必达 + 适配器翻译；物理 Worktree 隔离 = M8。反向顺序会造成
  "声明了但没人执行"的空窗——spec 显式禁止宣称物理隔离。
- "裸请求被适配器拒绝"（FR-006）是宪法 II "仅靠 Prompt 视为
  违规"的可测试化：强制层不可绕过。
- 真实 CLI e2e 依赖本机安装（缺失跳过）+ 单元层替身脚本矩阵
  保确定性——延续 codegraph 的成熟模式（宪法 IV）。
- 不静默降级 Fake（FR-007）：可预期性优先——用户显式选择
  真实运行时失败时报错，而非悄悄换假执行。
- 检查于 2026-09-11 全部通过（1 轮）。
