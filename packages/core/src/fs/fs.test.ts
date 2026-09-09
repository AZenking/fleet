import { describe, expect, it } from 'vitest';
import { loadFleetConfig } from '../config/loader.js';
import { MemoryFileSystem } from './index.js';

describe('MemoryFileSystem', () => {
  it('写入后可读取、可判存在', () => {
    const fs = new MemoryFileSystem();
    fs.writeFile('/repo/configs/fleet.yaml', 'version: 1');
    expect(fs.exists('/repo/configs/fleet.yaml')).toBe(true);
    expect(fs.readFile('/repo/configs/fleet.yaml')).toBe('version: 1');
  });

  it('readFileOptional 缺失时返回 undefined', () => {
    const fs = new MemoryFileSystem();
    expect(fs.readFileOptional('/repo/configs/fleet.yaml')).toBeUndefined();
  });

  it('listDir 返回直接子项（目录与文件）', () => {
    const fs = new MemoryFileSystem();
    fs.writeFile('/repo/configs/fleet.yaml', 'version: 1');
    fs.writeFile('/repo/configs/agents/roles.yaml', 'roles: []');
    expect(fs.listDir('/repo/configs').sort()).toEqual([
      'agents',
      'fleet.yaml',
    ]);
  });

  it('读取缺失文件抛错', () => {
    const fs = new MemoryFileSystem();
    expect(() => fs.readFile('/missing')).toThrowError();
  });
});

describe('config loader × MemoryFileSystem（不触碰真实磁盘）', () => {
  it('内存文件系统中的配置可被加载', () => {
    const fs = new MemoryFileSystem();
    const configPath = '/repo/configs/fleet.yaml';
    fs.writeFile(
      configPath,
      ['version: 1', 'defaults:', '  maxConcurrency: 8'].join('\n'),
    );
    const config = loadFleetConfig(fs.readFileOptional(configPath));
    expect(config.defaults.maxConcurrency).toBe(8);
  });

  it('内存中缺失的配置走 CONFIG_MISSING 路径', () => {
    const fs = new MemoryFileSystem();
    expect(() =>
      loadFleetConfig(fs.readFileOptional('/repo/configs/fleet.yaml')),
    ).toThrowError(/缺失/);
  });
});
