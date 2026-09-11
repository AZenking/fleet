# Quickstart: M8 Workspace + Git Worktree 验证指南

**Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

契约见 [contracts/workspace-api.md](contracts/workspace-api.md)。
e2e 全程 tmp git 仓库——**不触碰本仓库工作区**。

## 前置条件

- M0–M7 基线可用（`pnpm check` 全绿）
- git ≥ 2.20（worktree 机制）

## A. 生命周期（US1 / SC-001）

```bash
pnpm vitest run --project workspace
```

**预期**（tmp 夹具仓库自动化断言）：create → 写文件 → getDiff
含变更（未跟踪文件亦含）→ merge 后主分支可见 → destroy 后
worktree 目录与分支消失、主仓干净。空 diff merge = noop；二进制
文件 diff 有标注。

手工感受版（node 脚本 / 库调用）：

```bash
node --input-type=module -e "
// 库形态演示（dist）：tmp 仓库上跑完整生命周期
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitWorktreeManager } from './packages/workspace/dist/index.js';
const repo = mkdtempSync(path.join(tmpdir(), 'ws-demo-'));
const git = (cmd) => execSync(cmd, { cwd: repo });
git('git init -q'); writeFileSync(path.join(repo, 'a.txt'), 'base');
git('git add -A'); git('git -c user.email=t@t -c user.name=t commit -qm base');
const m = new GitWorktreeManager(repo);
const ws = await m.create('demo-task');
writeFileSync(path.join(ws.path, 'new.txt'), 'from worktree');
console.log('diff 含新文件:', (await m.getDiff(ws)).includes('new.txt'));
console.log('merge:', JSON.stringify(await m.merge(ws)));
console.log('主分支可见:', existsSync(path.join(repo, 'new.txt')));
console.log('destroy:', JSON.stringify(await m.destroy(ws)));
console.log('worktree 已清:', !existsSync(ws.path));
rmSync(repo, { recursive: true, force: true });
"
```

## B. 并行隔离三段式（US2 / SC-002，验收锚点）

```bash
pnpm vitest run --project cli-e2e tests/cli/workspace.test.ts
```

**预期**：tmp 仓库 + `write-cli.sh` 替身，双 reason 无依赖任务
并行——

1. 主仓 `git status --porcelain` 全程干净（50ms 轮询采样）
2. 两 worktree diff 互不可见（A 见不到 B 的文件）
3. 双 merge 后主分支两文件并存

## C. 权限物理范围（SC-005）

自动化断言（集成层）：只读角色（focus/insight/wisdom）请求
cwd = 主仓根；reason/reflex 请求 cwd = 各自 worktree 路径
（请求流 100% 对应）。

## D. 故障矩阵（US3 / SC-003 / SC-004）

自动化注入：dirty 主仓（拒绝 + 首个脏文件）/ 残留同名分支
（collision）/ 空仓 / 非仓库 / 上限触发 / merge 冲突（不强合 +
冲突清单 + 双方 pre-merge）/ 清理失败（残留报告）/ 孤儿
（worktree list 对照检测 + 清理归零）。每类 code 可断言、零崩溃、
零主仓污染。

run 中故障（SC-006）：worktree 故障的任务按 M5 语义失败/跳过，
run 报告 workspaces 字段含明细。

## E. 回退开关

```bash
# tmp 仓库上：--no-worktree → M7 行为（无 worktree 创建）
pnpm fleet run <mission> --no-worktree
```

## 完成判定

以上全部通过 = M8 验收（roadmap：**多个 Reason 并行执行时不能
污染主 Workspace，也不能互相污染**；六类故障处理完整）。
