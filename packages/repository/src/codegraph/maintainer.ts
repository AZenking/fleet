import { execa } from 'execa';

/**
 * CodeGraphMaintainer（specs/014 contracts §1）——索引维护的**唯一写
 * 接缝**（opt-in 策略授权调用；只读 adapter 红线不变）。
 *
 * 四条合同条款：① 纯执行器不做策略判断（判断属 investigate）；
 * ② 子进程封装现成 codegraph CLI（宪法 VI）；③ 异常不逃逸
 * （启动失败/非零/超时 → 结构化 MaintainOutcome）；④ 本组件是
 * cli-adapter 之外的独立类——只读 adapter 不 import 本文件。
 */

export type MaintainAction = 'init' | 'sync';

export interface MaintainOptions {
  timeoutMs: number;
}

export type MaintainOutcome =
  | { ok: true; durationMs: number }
  | {
      ok: false;
      kind: 'failed' | 'timeout';
      detail: string;
      durationMs: number;
    };

export interface CodeGraphMaintainer {
  init(options: MaintainOptions): Promise<MaintainOutcome>;
  sync(options: MaintainOptions): Promise<MaintainOutcome>;
}

export interface CliMaintainerOptions {
  repoRoot: string;
  /** 测试注入：命令名（缺省 codegraph） */
  command?: string;
}

export class CliCodeGraphMaintainer implements CodeGraphMaintainer {
  constructor(private readonly options: CliMaintainerOptions) {}

  async init(maintain: MaintainOptions): Promise<MaintainOutcome> {
    return this.run('init', maintain);
  }

  async sync(maintain: MaintainOptions): Promise<MaintainOutcome> {
    return this.run('sync', maintain);
  }

  private async run(
    action: MaintainAction,
    maintain: MaintainOptions,
  ): Promise<MaintainOutcome> {
    const started = Date.now();
    const command = this.options.command ?? 'codegraph';
    // detached：独立进程组——超时 kill(-pid) 连孙进程一起收（脚本
    // 可能 spawn 子任务持管道，单杀 bash 会让流不关闭）
    const child = execa(command, [action], {
      cwd: this.options.repoRoot,
      reject: false,
      detached: true,
      stdin: 'ignore',
    });
    let killedByTimer = false;
    const timer = setTimeout(() => {
      killedByTimer = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, maintain.timeoutMs);
    let result: Awaited<typeof child> | undefined;
    try {
      result = await child;
    } catch (error) {
      return {
        ok: false,
        kind: 'failed',
        detail: `codegraph ${action} 执行异常：${
          error instanceof Error ? error.message : String(error)
        }`,
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
    const durationMs = Date.now() - started;
    if (killedByTimer) {
      return {
        ok: false,
        kind: 'timeout',
        detail: `codegraph ${action} 超过 ${maintain.timeoutMs}ms`,
        durationMs,
      };
    }
    // ENOENT 等：reject:false 下 exitCode undefined（进程未真正运行）
    if (result.exitCode === undefined) {
      return {
        ok: false,
        kind: 'failed',
        detail: `codegraph ${action} 启动失败：命令不可执行（${command}）`,
        durationMs,
      };
    }
    if (result.exitCode !== 0) {
      return {
        ok: false,
        kind: 'failed',
        detail: `codegraph ${action} 退出码 ${result.exitCode}${
          result.stderr !== '' ? `：${result.stderr.split('\n')[0] ?? ''}` : ''
        }`,
        durationMs,
      };
    }
    return { ok: true, durationMs };
  }
}

/** Fake 步：按调用序出队（耗尽重复末项；缺省成功） */
export interface FakeMaintainStep {
  ok: boolean;
  kind?: 'failed' | 'timeout';
  detail?: string;
  delayMs?: number;
}

export class FakeCodeGraphMaintainer implements CodeGraphMaintainer {
  readonly calls: Array<{ action: MaintainAction; timeoutMs: number }> = [];
  private readonly queue: FakeMaintainStep[];

  constructor(script: FakeMaintainStep[] = []) {
    this.queue = [...script];
  }

  async init(maintain: MaintainOptions): Promise<MaintainOutcome> {
    return this.run('init', maintain);
  }

  async sync(maintain: MaintainOptions): Promise<MaintainOutcome> {
    return this.run('sync', maintain);
  }

  private async run(
    action: MaintainAction,
    maintain: MaintainOptions,
  ): Promise<MaintainOutcome> {
    this.calls.push({ action, timeoutMs: maintain.timeoutMs });
    const step =
      this.queue.length > 1
        ? this.queue.shift()!
        : (this.queue[0] ?? { ok: true });
    if ((step.delayMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }
    const durationMs = step.delayMs ?? 1;
    if (step.ok) {
      return { ok: true, durationMs };
    }
    return {
      ok: false,
      kind: step.kind ?? 'failed',
      detail: step.detail ?? `fake ${action} 失败`,
      durationMs,
    };
  }
}
