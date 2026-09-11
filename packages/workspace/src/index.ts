/**
 * @fleet/workspace — Fleet 物理工作区层（M8）。
 *
 * 模块一览（M9 验证层 / M11 恢复层从这里消费）：
 * - types     Workspace / MergeOutcome / DestroyOutcome / WorkspaceFault / Inventory
 * - git       受控 git 子进程（超时 + 结构化 fault）
 * - manager   GitWorktreeManager（create/getDiff/merge/destroy + 活动清单与上限）
 * - inventory 孤儿检测（worktree list 对照活动清单）+ 最小清理
 * - executor  WorkspaceResolvingExecutor（写角色建区/处置装饰器）
 */

export const WORKSPACE_READY = true;

export * from './types.js';
export * from './git.js';
export * from './manager.js';
export * from './inventory.js';
export * from './executor.js';
