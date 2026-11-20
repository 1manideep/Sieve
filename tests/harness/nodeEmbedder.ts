// An MlClient backed by the real MiniLM in a child Node process (tests/harness/embed-server.mjs).
// Model files come from spikes/search/.model-cache, so no download happens; when the cache is missing, available() is false.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { MlClient, MlTaskStatus } from '../../web/src/ml/client';
import type { EmbedInput, EmbedOutput, MlTask } from '../../web/src/ml/protocol';

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'spikes', 'search')) && existsSync(join(dir, 'tests', 'harness'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const MODEL_CACHE = join(repoRoot(), 'spikes', 'search', '.model-cache');

export function realModelAvailable(): boolean {
  return existsSync(join(MODEL_CACHE, 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx'));
}

export interface NodeEmbedClient extends MlClient {
  close(): void;
  calls: number;
}

export async function startNodeEmbedder(): Promise<NodeEmbedClient> {
  const root = repoRoot();
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [resolve(root, 'tests/harness/embed-server.mjs')], {
    cwd: root, env: { ...process.env, MODEL_DIR: MODEL_CACHE + '/' },
  });
  const pending = new Map<number, { resolve: (o: EmbedOutput) => void; reject: (e: unknown) => void }>();
  let nextId = 1;
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  const rl = createInterface({ input: child.stdout });
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    child.on('exit', (code) => rejectReady(new Error(`embed server exited ${code}: ${stderr.slice(0, 400)}`)));
    rl.on('line', (line) => {
      const msg = JSON.parse(line) as { ready?: boolean; id?: number; dims?: number; count?: number; data?: string; error?: string };
      if (msg.ready) return resolveReady();
      const p = msg.id !== undefined ? pending.get(msg.id) : undefined;
      if (!p || msg.id === undefined) return;
      pending.delete(msg.id);
      if (msg.error) return p.reject(new Error(msg.error));
      const buf = Buffer.from(msg.data ?? '', 'base64');
      const data = new Float32Array(buf.byteLength / 4);
      new Uint8Array(data.buffer).set(buf);
      p.resolve({ dims: msg.dims ?? 384, count: msg.count ?? 0, data });
    });
  });
  await ready;
  const status: MlTaskStatus = { state: 'ready', device: 'wasm' };
  const client: NodeEmbedClient = {
    calls: 0,
    async warmup() {},
    async run<I, O>(_task: MlTask, input: I): Promise<O> {
      client.calls++;
      const id = nextId++;
      const out = await new Promise<EmbedOutput>((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        child.stdin.write(JSON.stringify({ id, texts: (input as unknown as EmbedInput).texts }) + '\n');
      });
      return out as unknown as O;
    },
    status: () => status,
    subscribe: () => () => undefined,
    close() {
      child.kill();
    },
  };
  return client;
}
