# Contract: .fleet/wiki 文件格式（M2）

**Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

本契约定义磁盘上的 wiki 格式——它是 Fleet 与"任何读者"（人、Codex
会话、外部 LLM 工具）之间的公开接口：外部工具按本格式写入的内容，
受同等校验与保护。

## 目录结构

```text
.fleet/wiki/
├── index.md              # 导航入口（generated）
├── architecture/
│   └── overview.md       # 顶层结构 + 内部依赖图（generated）
├── domains/              # monorepo 每包一页；非 monorepo 按顶层目录
│   └── <包名>.md
├── infrastructure/
│   └── tooling.md        # 构建/测试/质量门（generated）
├── decisions/            # 架构决策记录（manual 为主，骨架 generated）
│   └── README.md
├── glossary.md           # 术语表（骨架 generated，条目人工补充）
└── .backup/              # update 时 mixed 页的上一代备份（滚动一代）
```

## 页面格式

```markdown
---
title: core（共享基础能力）
generated_from: e0446531a2c...   # 7–40 hex；非 git 仓库整行省略
updated_at: 2026-09-10T12:00:00.000Z
scope:
  - packages/core
---

<!-- fleet:generated -->
（生成器产出区：模块清单、入口、依赖、路径引用）
<!-- /fleet:generated -->

（围栏外 = 人工区：任意 Markdown，update 永不触碰）
```

规则：

- front matter 必须是首个 `---` 块；字段校验见 data-model.md §1
- 围栏标记独占一行，成对出现（`unpaired_fence` 校验错误）
- origin 推导：无围栏 = manual；有围栏 + 围栏外有实质内容 = mixed；
  否则 generated（research.md D2）
- 人工页面（用户自建 .md）只要 front matter 合法即被 index 收录，
  scope 由作者自填（参与 status/update 判定，update 只提示不重写）

## generated 区块内容约定

- 路径引用一律写仓库相对路径（反引号包裹），validator 逐一锚定
  磁盘存在性（FR-004）
- 区块可含小节标题（`##` 级）；query 排序对小节标题加权 ×2
- 非 git 仓库：区块头部渲染一行 `generated_from: missing`（不伪造
  锚点，FR-002 / US1 场景 4）

## index.md 格式

```markdown
---
title: index
generated_from: <sha>
updated_at: <ts>
scope:
  - .
---
<!-- fleet:generated -->
# Repository Wiki

## architecture
- [overview](architecture/overview.md) — 顶层结构与依赖
## domains
- [core](domains/core.md) — 共享基础能力
...
<!-- /fleet:generated -->
```

index 由页面清单生成（build/update 后同步）；`index_out_of_sync`
= 存在页面未被 index 收录（validator 校验项）。

## scope 匹配语义（research.md D3）

- 元素为仓库相对路径前缀，尾部 `/` 归一；`.` = 全仓库
- 匹配 = changed file 路径以该前缀开头（纯字符串，无 glob）
- 页面 stale ⇔ changed files ∩ scope ≠ ∅；受影响页面占比 > 70% 时
  status 建议全量 rebuild
