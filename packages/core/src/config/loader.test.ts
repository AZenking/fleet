import { describe, expect, it } from 'vitest';
import { ErrorCodes, FleetError } from '../errors/index.js';
import { loadFleetConfig } from './loader.js';

describe('loadFleetConfig', () => {
  it('解析最小合法配置并应用默认值', () => {
    const config = loadFleetConfig('version: 1');
    expect(config.version).toBe(1);
    expect(config.defaults.maxConcurrency).toBe(3);
    expect(config.defaults.retry).toBe(1);
  });

  it('解析完整配置样例', () => {
    const config = loadFleetConfig(
      [
        'version: 1',
        'repository: .',
        'defaults:',
        '  maxConcurrency: 5',
        '  retry: 2',
      ].join('\n'),
    );
    expect(config.repository).toBe('.');
    expect(config.defaults.maxConcurrency).toBe(5);
    expect(config.defaults.retry).toBe(2);
  });

  it('raw 为 undefined 时抛 CONFIG_MISSING', () => {
    expect(() => loadFleetConfig(undefined)).toThrowError(FleetError);
    try {
      loadFleetConfig(undefined);
    } catch (error) {
      expect((error as FleetError).code).toBe(ErrorCodes.CONFIG_MISSING);
    }
  });

  it('空文件抛 CONFIG_EMPTY（spec 边界：空配置）', () => {
    try {
      loadFleetConfig('   \n  \n');
      expect.unreachable('应当抛出 CONFIG_EMPTY');
    } catch (error) {
      expect((error as FleetError).code).toBe(ErrorCodes.CONFIG_EMPTY);
    }
  });

  it('version 非法时逐字段报错（quickstart 注入 #5）', () => {
    try {
      loadFleetConfig('version: 2');
      expect.unreachable('应当抛出 CONFIG_INVALID');
    } catch (error) {
      const fleetError = error as FleetError;
      expect(fleetError.code).toBe(ErrorCodes.CONFIG_INVALID);
      const issues = fleetError.context['issues'] as Array<{ path: string }>;
      expect(issues.some((issue) => issue.path === 'version')).toBe(true);
    }
  });

  it('retry 越界时定位到 defaults.retry', () => {
    try {
      loadFleetConfig(['version: 1', 'defaults:', '  retry: -1'].join('\n'));
      expect.unreachable('应当抛出 CONFIG_INVALID');
    } catch (error) {
      const issues = (error as FleetError).context['issues'] as Array<{
        path: string;
      }>;
      expect(issues.some((issue) => issue.path === 'defaults.retry')).toBe(
        true,
      );
    }
  });

  it('未知字段被 strict 拒绝并定位', () => {
    try {
      loadFleetConfig(['version: 1', 'unknownField: 1'].join('\n'));
      expect.unreachable('应当抛出 CONFIG_INVALID');
    } catch (error) {
      const fleetError = error as FleetError;
      expect(fleetError.code).toBe(ErrorCodes.CONFIG_INVALID);
      const issues = fleetError.context['issues'] as Array<{ path: string }>;
      expect(issues.some((issue) => issue.path === 'unknownField')).toBe(true);
    }
  });

  it('非法 YAML 抛 CONFIG_INVALID 且附原因', () => {
    try {
      loadFleetConfig('version: [unclosed');
      expect.unreachable('应当抛出 CONFIG_INVALID');
    } catch (error) {
      expect((error as FleetError).code).toBe(ErrorCodes.CONFIG_INVALID);
    }
  });

  it('顶层不是映射时报 <root> 问题', () => {
    try {
      loadFleetConfig('- a\n- b\n');
      expect.unreachable('应当抛出 CONFIG_INVALID');
    } catch (error) {
      const issues = (error as FleetError).context['issues'] as Array<{
        path: string;
      }>;
      expect(issues[0]?.path).toBe('<root>');
    }
  });
});
