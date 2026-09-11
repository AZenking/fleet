# Quickstart: M12 MCP + Codex Desktop + Control Center 验证指南

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/mcp-api.md](contracts/mcp-api.md)

## 前置

```bash
pnpm build && pnpm test
```

## 场景 1 — 握手与工具清单（SC-001）

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node apps/cli/dist/bin.js mcp repo
```

**预期**：id=1 返回协议版本与能力；id=2 列出 7 工具（schema 齐备）。

## 场景 2 — Repository Intelligence 全工具（SC-002）

对 sample 夹具仓库逐工具 tools/call：investigate 返回 findings；
symbol/impact 返回命中（或结构化降级——CodeGraph 缺失时）；
verify 锚定核验；wiki_query/read 返回检索与页面。

## 场景 3 — Fleet 全工作流（SC-003，e2e 承载）

create（合法落盘 / 非法结构化拒绝）→ run（tmp git 仓库 + Fake）→
status（分布）→ result（ReviewPackageView：审阅 + 预算 + diff）→
cancel（活跃 run → cancelled）。

## 场景 4 — 协议健壮性（SC-004）

坏 JSON / 未知方法 / 握手前调用 / 工具参数错误 → 标准错误响应；
连续请求服务存活。

## 场景 5 — 数据面与延期（SC-005）

docs/control-center.md：十一面板映射矩阵全有源 + 延期依据齐备。

## 成功判据（对齐 spec SC-001..006）

全部由 `tests/cli/mcp.test.ts` + `packages/mcp` 单测自动化承载。
