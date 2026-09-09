// 与 src/logging.ts 中的 Logger 同名 —— 歧义（ambiguous）场景夹具
export class Logger {
  log(message: string): void {
    console.error(message);
  }
}
