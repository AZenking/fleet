/**
 * Logger 接口与默认实现（data-model.md / plan.md logging 模块）。
 * M0 提供同步 console 适配；后续里程碑可替换为结构化输出实现。
 */

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function format(message: string, meta?: Record<string, unknown>): string {
  return meta === undefined ? message : `${message} ${JSON.stringify(meta)}`;
}

/** 常规 console 日志（debug/info → stdout，warn/error → stderr）。 */
export const consoleLogger: Logger = {
  debug: (message, meta) => console.log(format(message, meta)),
  info: (message, meta) => console.log(format(message, meta)),
  warn: (message, meta) => console.error(format(message, meta)),
  error: (message, meta) => console.error(format(message, meta)),
};

/** 全部走 stderr 的日志：机器消费 stdout（如 --json）时不被污染。 */
export const stderrLogger: Logger = {
  debug: (message, meta) => console.error(format(message, meta)),
  info: (message, meta) => console.error(format(message, meta)),
  warn: (message, meta) => console.error(format(message, meta)),
  error: (message, meta) => console.error(format(message, meta)),
};

/** 静默日志：测试与库内默认。 */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
