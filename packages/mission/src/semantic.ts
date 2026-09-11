import type { ConfigIssue } from '@fleet/core';

import type { Mission } from './types.js';

/**
 * 语义校验层（research.md D3）：跨字段/跨元素规则，纯函数、
 * 一次报全（FR-007）。M5 可对运行时动态产生的任务二次复用
 * （research.md D8）。多节点环检测属 M5 DAG 模块，此处只查
 * 引用闭合与自环。
 */

export function validateSemantics(mission: Mission): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const tasks = mission.tasks ?? [];

  // —— task id 唯一性（标出全部冲突位置）——
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
          expected: 'mission 内唯一',
          received: id,
          message: `task id 重复：${id}（首见 tasks.${first}，此处 tasks.${index}）`,
        });
      }
    }
  }

  // —— dependsOn 引用闭合 + 自环 ——
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

  // —— requirement id 唯一性 ——
  const reqIds = new Map<string, number>();
  mission.requirements.forEach((requirement, index) => {
    if (requirement.id === undefined) {
      return;
    }
    const first = reqIds.get(requirement.id);
    if (first !== undefined) {
      issues.push({
        path: `requirements.${index}.id`,
        expected: 'mission 内唯一',
        received: requirement.id,
        message: `requirement id 重复（首见 requirements.${first}）`,
      });
    } else {
      reqIds.set(requirement.id, index);
    }
  });

  // —— planningMode 完备性（宪法 V 输入契约，US2 场景 2）——
  if (mission.planningMode === 'execution') {
    if (mission.plan === undefined) {
      issues.push({
        path: 'plan',
        expected: '已确认的执行方案（plan.summary）',
        received: '缺失',
        message:
          'execution 模式要求 plan：方案已在 Codex Desktop 确认，mission 必须携带（Reason 不得擅自推翻）',
      });
    }
    if (tasks.length === 0) {
      issues.push({
        path: 'tasks',
        expected: '非空任务列表',
        received: tasks.length === 0 ? '空' : '缺失',
        message:
          'execution 模式要求非空 tasks：已确认方案必须包含任务拆解（autonomous 才允许留给 Reason 规划）',
      });
    }
  }

  return issues;
}
