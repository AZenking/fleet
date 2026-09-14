import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CliCodeGraphMaintainer,
  FakeCodeGraphMaintainer,
} from './maintainer.js';

/** T001：Cli 三态（PATH 替身）/ Fake 出队语义 / 异常不逃逸 */

const okScript = '#!/usr/bin/env bash\necho synced\n';
const failScript = '#!/usr/bin/env bash\necho boom >&2\nexit 3\n';
const hangScript = '#!/usr/bin/env bash\nsleep 30\n';

function maintainerOf(script: string): CliCodeGraphMaintainer {
  const repo = mkdtempSync(path.join(tmpdir(), 'fleet-maint-'));
  const file = path.join(repo, 'codegraph-fake');
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return new CliCodeGraphMaintainer({ repoRoot: repo, command: file });
}

describe('CliCodeGraphMaintainer', () => {
  it('成功：退出码 0 → ok + durationMs', async () => {
    const m = maintainerOf(okScript);
    const outcome = await m.sync({ timeoutMs: 5000 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('失败：非零退出 → failed + stderr 首行', async () => {
    const m = maintainerOf(failScript);
    const outcome = await m.sync({ timeoutMs: 5000 });
    expect(outcome).toMatchObject({ ok: false, kind: 'failed' });
    if (!outcome.ok) {
      expect(outcome.detail).toContain('退出码 3');
      expect(outcome.detail).toContain('boom');
    }
  });

  it('超时：挂起脚本 → timeout + 不悬挂', async () => {
    const m = maintainerOf(hangScript);
    const outcome = await m.sync({ timeoutMs: 300 });
    expect(outcome).toMatchObject({ ok: false, kind: 'timeout' });
  }, 5000);

  it('启动失败（命令不存在）→ failed，异常不逃逸', async () => {
    const m = new CliCodeGraphMaintainer({
      repoRoot: process.cwd(),
      command: 'definitely-missing-cmd-xyz',
    });
    const outcome = await m.init({ timeoutMs: 1000 });
    expect(outcome).toMatchObject({ ok: false, kind: 'failed' });
    expect((outcome as { detail: string }).detail).toContain('启动失败');
  });
});

describe('FakeCodeGraphMaintainer', () => {
  it('按调用序出队；耗尽重复末项；调用记录可断言', async () => {
    const fake = new FakeCodeGraphMaintainer([
      { ok: false, kind: 'timeout', detail: '第一次超时' },
      { ok: true },
    ]);
    const first = await fake.sync({ timeoutMs: 100 });
    expect(first).toMatchObject({ ok: false, kind: 'timeout' });
    const second = await fake.sync({ timeoutMs: 100 });
    expect(second.ok).toBe(true);
    const third = await fake.sync({ timeoutMs: 100 }); // 耗尽重复末项（成功）
    expect(third.ok).toBe(true);
    expect(fake.calls).toEqual([
      { action: 'sync', timeoutMs: 100 },
      { action: 'sync', timeoutMs: 100 },
      { action: 'sync', timeoutMs: 100 },
    ]);
  });

  it('空脚本缺省成功；init/sync 动作区分记录', async () => {
    const fake = new FakeCodeGraphMaintainer();
    expect((await fake.init({ timeoutMs: 50 })).ok).toBe(true);
    expect(fake.calls[0]).toEqual({ action: 'init', timeoutMs: 50 });
  });
});
