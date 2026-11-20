// An in-memory FileSystemDirectoryHandle (70 section 15.3) for folder tests: write, remove, move, failNext,
// setPermission and a self loop. Files are Node File objects so they survive structured cloning in fake-indexeddb.
import { File as NodeFile } from 'node:buffer';

type Perm = 'granted' | 'prompt' | 'denied';
type FailName = 'NotReadableError' | 'NotFoundError' | 'NotAllowedError';

interface Node { kind: 'file' | 'directory'; name: string }
interface MemFileNode extends Node { kind: 'file'; bytes: Uint8Array; lastModified: number }
interface MemDirNode extends Node { kind: 'directory'; children: Map<string, MemFileNode | MemDirNode>; loop?: boolean }

function domError(name: string, message = name): DOMException {
  return new DOMException(message, name);
}

export class MemFolder {
  readonly rootNode: MemDirNode;
  permission: Perm = 'granted';
  requestAnswer: Perm = 'granted';
  private fails = new Map<string, FailName>();
  readCount = 0;
  walkFailAfter: { count: number; name: FailName } | null = null;
  private walked = 0;
  rootMissing = false;

  constructor(name = 'Documents') {
    this.rootNode = { kind: 'directory', name, children: new Map() };
  }

  private dirFor(path: string, create: boolean): { dir: MemDirNode; leaf: string } {
    const parts = path.split('/').filter(Boolean);
    let dir = this.rootNode;
    for (const p of parts.slice(0, -1)) {
      let next = dir.children.get(p);
      if (!next) {
        if (!create) throw domError('NotFoundError');
        next = { kind: 'directory', name: p, children: new Map() };
        dir.children.set(p, next);
      }
      if (next.kind !== 'directory') throw domError('TypeMismatchError');
      dir = next;
    }
    return { dir, leaf: parts[parts.length - 1] ?? '' };
  }

  write(path: string, content: string | Uint8Array, opts?: { lastModified?: number }): this {
    const { dir, leaf } = this.dirFor(path, true);
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    dir.children.set(leaf, { kind: 'file', name: leaf, bytes, lastModified: opts?.lastModified ?? Date.now() });
    return this;
  }

  remove(path: string): void {
    const { dir, leaf } = this.dirFor(path, false);
    dir.children.delete(leaf);
  }

  move(from: string, to: string): void {
    const { dir, leaf } = this.dirFor(from, false);
    const node = dir.children.get(leaf);
    if (!node || node.kind !== 'file') throw domError('NotFoundError');
    dir.children.delete(leaf);
    const target = this.dirFor(to, true);
    target.dir.children.set(target.leaf, { ...node, name: target.leaf });
  }

  failNext(path: string, name: FailName): void {
    this.fails.set(path, name);
  }

  setPermission(p: Perm): void {
    this.permission = p;
  }

  selfLoop(path: string): void {
    const { dir, leaf } = this.dirFor(path + '/x', true);
    dir.children.delete(leaf);
    dir.loop = true;
  }

  /** The root as a FileSystemDirectoryHandle. Stored in IndexedDB rows by reference in tests (see noClone). */
  get root(): FileSystemDirectoryHandle {
    return dirHandle(this, this.rootNode, '') as FileSystemDirectoryHandle;
  }

  /** @internal used by the handle builders below */
  takeFail(path: string): FailName | undefined {
    const f = this.fails.get(path);
    if (f) this.fails.delete(path);
    return f;
  }

  /** @internal counts entries seen by walks, for walkFailAfter */
  countWalk(): number {
    return ++this.walked;
  }

  resetWalkCount(): void {
    this.walked = 0;
  }
}

function fileHandle(folder: MemFolder, path: string, node: MemFileNode) {
  return {
    kind: 'file' as const,
    name: node.name,
    async getFile(): Promise<File> {
      const fail = folder.takeFail(path);
      if (fail) throw domError(fail);
      if (folder.permission !== 'granted') throw domError('NotAllowedError');
      folder.readCount++;
      const type = /\.jpe?g$/i.test(node.name) ? 'image/jpeg' : /\.png$/i.test(node.name) ? 'image/png' : /\.pdf$/i.test(node.name) ? 'application/pdf' : '';
      return new NodeFile([node.bytes], node.name, { lastModified: node.lastModified, type }) as unknown as File;
    },
  };
}

function dirHandle(folder: MemFolder, node: MemDirNode, prefix: string): unknown {
  return {
    kind: 'directory' as const,
    name: node.name,
    async *entries(): AsyncIterableIterator<[string, unknown]> {
      if (folder.rootMissing && node === folder.rootNode) throw domError('NotFoundError');
      if (folder.permission !== 'granted') throw domError('NotAllowedError');
      for (const [name, child] of node.children) {
        const n = folder.countWalk();
        if (folder.walkFailAfter && n > folder.walkFailAfter.count) throw domError(folder.walkFailAfter.name);
        if (child.kind === 'file') yield [name, fileHandle(folder, prefix + name, child)];
        else yield [name, dirHandle(folder, child, prefix + name + '/')];
      }
      if (node.loop) yield ['loop', dirHandle(folder, node, prefix + 'loop/')];
    },
    async getDirectoryHandle(name: string) {
      const child = node.children.get(name);
      if (!child) throw domError('NotFoundError');
      if (child.kind !== 'directory') throw domError('TypeMismatchError');
      return dirHandle(folder, child, prefix + name + '/');
    },
    async getFileHandle(name: string) {
      const child = node.children.get(name);
      if (!child) throw domError('NotFoundError');
      if (child.kind !== 'file') throw domError('TypeMismatchError');
      return fileHandle(folder, prefix + name, child);
    },
    async queryPermission() {
      return folder.permission;
    },
    async requestPermission() {
      folder.permission = folder.requestAnswer;
      return folder.permission;
    },
  };
}

interface HookTable {
  hook(event: 'creating', fn: (key: unknown, obj: Record<string, unknown>) => void): void;
  hook(event: 'updating', fn: (mods: Record<string, unknown>) => Record<string, unknown> | void): void;
  hook(event: 'reading', fn: (obj: Record<string, unknown>) => Record<string, unknown>): void;
}

/**
 * Chrome stores directory handles in IndexedDB by structured clone; fake-indexeddb cannot clone a JS object with
 * methods. These Dexie hooks store a marker instead and hand back the live handle on read.
 */
export function attachMemFolder(db: { sources: unknown }, folder: MemFolder): void {
  const table = db.sources as HookTable;
  const handle = folder.root;
  const marker = { memFolder: folder.rootNode.name };
  table.hook('creating', (_key, obj) => {
    if (obj?.folderHandle) obj.folderHandle = marker;
  });
  table.hook('updating', (mods) => (mods?.folderHandle ? { folderHandle: marker } : undefined));
  table.hook('reading', (obj) => (obj?.folderHandle ? { ...obj, folderHandle: handle } : obj));
}
