import { FleetError, type ConfigIssue } from '@fleet/core';
import type { Task } from '@fleet/mission';

import type { DagNode, StatusCounts, TaskDag } from './types.js';

/**
 * DAG 构建与查询（research.md D1/D2/D3）：
 * - 构建即校验：重复 id / 悬空依赖 / 自环 / 多节点环（DFS 三色
 *   + 栈回溯报精确环链）——对静态 mission 与运行时动态任务一致
 * - Map 插入序 = mission 声明序（稳定派发序来源，SC-006）
 */

export class DagBuildError extends FleetError {
  constructor(message: string, issues: ConfigIssue[]) {
    super('DAG_BUILD_INVALID', 'internal', message, { issues });
    this.name = 'DagBuildError';
  }
}

class TaskDagImpl implements TaskDag {
  constructor(
    private readonly nodes: Map<string, DagNode>,
    private readonly dependents: Map<string, string[]>,
  ) {}

  snapshot() {
    return [...this.nodes.values()].map((node) => ({
      taskId: node.taskId,
      status: node.status,
      attempts: node.attempts,
      ...(node.failureReason !== undefined
        ? { failureReason: node.failureReason }
        : {}),
      ...(node.skippedBy !== undefined ? { skippedBy: node.skippedBy } : {}),
    }));
  }

  node(taskId: string): DagNode | undefined {
    return this.nodes.get(taskId);
  }

  readyTasks(): DagNode[] {
    return [...this.nodes.values()].filter(
      (node) =>
        node.status === 'pending' &&
        node.task.dependsOn.every(
          (dep) => this.nodes.get(dep)?.status === 'completed',
        ),
    );
  }

  counts(): StatusCounts {
    const counts: StatusCounts = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    };
    for (const node of this.nodes.values()) {
      if (node.status !== 'cancelled') {
        counts[node.status] += 1;
      }
    }
    return counts;
  }

  dependentsOf(taskId: string): readonly string[] {
    return this.dependents.get(taskId) ?? [];
  }

  /** 调度器内部用：全部节点（声明序） */
  allNodes(): DagNode[] {
    return [...this.nodes.values()];
  }
}

/** 构建任务图（校验 + 建边）。非法输入抛 DagBuildError（issues 逐项）。 */
export function buildDag(tasks: Task[]): TaskDagImpl {
  const issues: ConfigIssue[] = [];

  const seen = new Map<string, number[]>();
  tasks.forEach((task, index) => {
    const positions = seen.get(task.id) ?? [];
    positions.push(index);
    seen.set(task.id, positions);
  });
  for (const [id, positions] of seen) {
    if (positions.length > 1) {
      const first = positions[0]!;
      for (const index of positions.slice(1)) {
        issues.push({
          path: `tasks.${index}.id`,
          expected: 'DAG 内唯一',
          received: id,
          message: `task id 重复（首见 tasks.${first}）`,
        });
      }
    }
  }

  const knownIds = new Set(seen.keys());
  tasks.forEach((task, index) => {
    for (const dep of task.dependsOn) {
      if (dep === task.id) {
        issues.push({
          path: `tasks.${index}.dependsOn`,
          expected: '不引用自身',
          received: dep,
          message: `自环依赖：${task.id} 依赖自己`,
        });
      } else if (!knownIds.has(dep)) {
        issues.push({
          path: `tasks.${index}.dependsOn`,
          expected: '引用存在的 task id',
          received: dep,
          message: `悬空依赖：${task.id} 依赖的 ${dep} 不存在`,
        });
      }
    }
  });

  const cycle = detectCycle(tasks);
  if (cycle !== undefined) {
    issues.push({
      path: 'tasks',
      expected: '无环依赖图（DAG）',
      received: cycle.chain.join(' -> '),
      message: `检测到依赖环：${cycle.chain.join(' -> ')}——环上任务无法调度`,
    });
  }

  if (issues.length > 0) {
    throw new DagBuildError(
      `任务图构建失败（${issues.length} 个问题）`,
      issues,
    );
  }

  const nodes = new Map<string, DagNode>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    nodes.set(task.id, {
      taskId: task.id,
      task,
      status: 'pending',
      attempts: 0,
    });
    dependents.set(task.id, []);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      dependents.get(dep)?.push(task.id);
    }
  }
  return new TaskDagImpl(nodes, dependents);
}

interface CycleChain {
  chain: string[];
}

/** DFS 三色检测（white/gray/black），起点按声明序；回边沿栈回溯出链 */
function detectCycle(tasks: Task[]): CycleChain | undefined {
  const color = new Map<string, 'white' | 'gray' | 'black'>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    color.set(task.id, 'white');
  }
  const stack: string[] = [];

  const visit = (id: string): CycleChain | undefined => {
    color.set(id, 'gray');
    stack.push(id);
    const deps = byId.get(id)?.dependsOn ?? [];
    for (const dep of deps) {
      if (dep === id) {
        continue; // 自环已由专门检查报告，不重复计
      }
      if (!byId.has(dep)) {
        continue; // 悬空已在别处报错
      }
      const depColor = color.get(dep);
      if (depColor === 'gray') {
        // 回边：从栈中 dep 的位置回溯到栈顶 = 环链
        const start = stack.indexOf(dep);
        return { chain: [...stack.slice(start), dep] };
      }
      if (depColor === 'white') {
        const found = visit(dep);
        if (found !== undefined) {
          return found;
        }
      }
    }
    stack.pop();
    color.set(id, 'black');
    return undefined;
  };

  for (const task of tasks) {
    if (color.get(task.id) === 'white') {
      const found = visit(task.id);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

export { TaskDagImpl };
