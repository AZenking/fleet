import { spawn } from 'node:child_process';

import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from './types.js';
import { assertPermissionEnv, parseUsageMarker } from './types.js';

/**
 * CliRuntimeAdapter 基座（research.md D4）：
 * - 入口权限强制（裸请求不启子进程）
 * - detached 进程组 + kill(-pid, SIGKILL)——timeout/cancel 组杀，
 *   孙进程同灭（无孤儿）；迟到输出丢弃（M6 单次 settle 守卫）
 * - stdin ignore（交互即超时路径）；stdout 截断 64KB + 标注
 * 三适配器（pi/codex/gemini）只差 command + buildArgs 配置。
 */

export const MAX_OUTPUT_BYTES = 64 * 1024;

export interface CliRuntimeConfig {
  /** 运行时名义（请求流记录 / 探测） */
  name: string;
  command: string;
  /** 参数模板：prompt 与权限约束的注入方式 */
  buildArgs: (request: RuntimeRequest) => string[];
  /** 额外环境（探测 / 测试注入替身 PATH 等） */
  env?: Record<string, string>;
  /** 探测用参数（默认 ['--version']） */
  versionArgs?: string[];
}

interface InflightProcess {
  settled: boolean;
  pid: number;
  child: ReturnType<typeof spawn>;
  cancelFn: () => void;
}

export class CliRuntimeAdapter implements RuntimeAdapter {
  private readonly inflight = new Map<string, InflightProcess>();

  constructor(readonly config: CliRuntimeConfig) {}

  get inflightSize(): number {
    return this.inflight.size;
  }

  execute(request: RuntimeRequest): Promise<RuntimeResult> {
    const permission = assertPermissionEnv(request);
    if (!permission.ok) {
      // 裸请求拒绝：不启动任何子进程（FR-006）
      return Promise.resolve({
        ok: false,
        code: 'error',
        detail: permission.reason,
      });
    }
    return new Promise<RuntimeResult>((resolve) => {
      // M11 派生标记：bash 包装层常驻（argv 含 FLEET_CHILD=1——
      // ps 可见；macOS 不再显示子进程 env，exec 前缀会被替换掉）
      const child = spawn(
        '/bin/bash',
        [
          '-c',
          'export FLEET_CHILD=1; "$0" "$@"',
          this.config.command,
          ...this.config.buildArgs(request),
        ],
        {
          cwd: request.cwd,
          detached: true, // 进程组——kill(-pid) 覆盖孙进程
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...(this.config.env ?? {}),
            ...(request.env ?? {}),
          },
        },
      );
      const state: InflightProcess = {
        settled: false,
        pid: child.pid ?? -1,
        child,
        cancelFn: () => {},
      };
      this.inflight.set(request.runId, state);

      let stdout = '';
      let stderrHead = '';

      const finish = (result: RuntimeResult): void => {
        if (state.settled) {
          return; // 单次 settle：迟到输出丢弃（M6 条款 2/3）
        }
        state.settled = true;
        clearTimeout(timeoutTimer);
        this.killGroup(state); // 全路径清理（条款 4）
        this.inflight.delete(request.runId);
        resolve(result);
      };

      const timeoutTimer = setTimeout(
        () =>
          finish({
            ok: false,
            code: 'timeout',
            detail: `执行超过预算 ${request.timeoutMs}ms（进程组已终止）`,
          }),
        request.timeoutMs,
      );

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) {
          stdout += chunk
            .toString('utf8')
            .slice(0, MAX_OUTPUT_BYTES - stdout.length);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrHead === '') {
          stderrHead = chunk.toString('utf8').split('\n')[0] ?? '';
        }
      });

      child.on('error', (error) => {
        finish({
          ok: false,
          code: 'error',
          detail: `启动失败：${this.config.command}（${error.message}）`,
        });
      });
      child.on('close', (code) => {
        if (state.settled) {
          return; // timeout/cancel 先到，丢弃迟到退出
        }
        const truncated = stdout.length >= MAX_OUTPUT_BYTES;
        if (code === 0) {
          // M10 标记行协议：输出含 FLEET_USAGE 行才采纳（否则 unmeasured）
          const usage = parseUsageMarker(stdout);
          finish({
            ok: true,
            output: truncated ? `${stdout}\n[输出已截断至 64KB]` : stdout,
            ...(usage !== undefined ? { usage } : {}),
          });
        } else {
          finish({
            ok: false,
            code: 'error',
            detail: `CLI 退出码 ${code}${stderrHead !== '' ? `：${stderrHead}` : ''}`,
          });
        }
      });

      // cancel 通道：cancel(runId) 调用组杀 → cancelled settle
      state.cancelFn = () =>
        finish({
          ok: false,
          code: 'cancelled',
          detail: `run ${request.runId} 已取消（进程组已终止）`,
        });
    });
  }

  async cancel(runId: string): Promise<void> {
    const state = this.inflight.get(runId);
    state?.cancelFn();
  }

  /** 组杀（SIGKILL，负 PID）；已退出则忽略错误 */
  private killGroup(state: InflightProcess): void {
    try {
      if (state.pid > 0) {
        process.kill(-state.pid, 'SIGKILL');
      }
    } catch {
      // 进程已退出（ESRCH）——无需处理
    }
    state.child.removeAllListeners();
  }
}
