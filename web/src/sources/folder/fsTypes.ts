// The parts of the File System Access API Sieve uses that TypeScript's lib.dom lacks (20 V-21.19: declared locally
// instead of @types/wicg-file-system-access, which conflicts with lib.dom).

export type FsPermission = 'granted' | 'denied' | 'prompt';

export interface DirHandle {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterableIterator<[string, DirHandle | FileHandle]>;
  getDirectoryHandle(name: string): Promise<DirHandle>;
  getFileHandle(name: string): Promise<FileHandle>;
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<FsPermission>;
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<FsPermission>;
}

export interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

export type ShowDirectoryPicker = (opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<DirHandle>;

export function asDir(h: FileSystemDirectoryHandle | DirHandle): DirHandle {
  return h as unknown as DirHandle;
}

export function asStored(h: DirHandle): FileSystemDirectoryHandle {
  return h as unknown as FileSystemDirectoryHandle;
}

export function directoryPicker(): ShowDirectoryPicker | undefined {
  const w = globalThis as unknown as { showDirectoryPicker?: ShowDirectoryPicker };
  return typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker.bind(globalThis) : undefined;
}
