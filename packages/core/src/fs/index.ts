import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * 文件系统抽象（FR-010）：核心逻辑经 FileSystemPort 访问磁盘，
 * 测试可用 MemoryFileSystem 在不触碰真实磁盘的前提下运行。
 */

export interface FileSystemPort {
  readFile(path: string): string;
  readFileOptional(path: string): string | undefined;
  exists(path: string): boolean;
  writeFile(path: string, content: string): void;
  listDir(path: string): string[];
}

export class RealFileSystem implements FileSystemPort {
  readFile(path: string): string {
    return readFileSync(path, 'utf8');
  }

  readFileOptional(path: string): string | undefined {
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  writeFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }

  listDir(path: string): string[] {
    return [...readdirSync(path)];
  }
}

export class MemoryFileSystem implements FileSystemPort {
  private readonly files = new Map<string, string>();

  readFile(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`文件不存在：${path}`);
    }
    return content;
  }

  readFileOptional(path: string): string | undefined {
    return this.files.get(path);
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  listDir(path: string): string[] {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const children = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        children.add(key.slice(prefix.length).split('/')[0] ?? '');
      }
    }
    return [...children];
  }
}
