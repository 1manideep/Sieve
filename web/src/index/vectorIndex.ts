// In-memory vector index (20 section 7.4): one growable Float32Array, brute-force cosine (vectors are normalized).
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from '@sieve/shared';
import type { SieveDb, VectorRow } from './db';

export interface ChunkHit { recordId: string; chunkIdx: number; start: number; end: number; score: number }

export interface VectorIndex {
  load(db: SieveDb, versions?: Map<string, number>): Promise<{ rows: number; orphans: string[]; stale: string[] }>;
  scan(q: Float32Array, accept: (recordId: string) => boolean, topRecords: number): ChunkHit[];
  upsertRecord(recordId: string, rows: VectorRow[]): void;
  removeRecord(recordId: string): void;
  similarTo(recordId: string, topRecords: number, accept: (id: string) => boolean): ChunkHit[];
  has(recordId: string): boolean;
  versionOf(recordId: string): number | undefined;
  inputHashOf(recordId: string): string | undefined;
  recordIds(): string[];
  clear(): void;
  readonly rows: number;
  readonly records: number;
}

const D = EMBEDDING_DIMS;

class MatrixIndex implements VectorIndex {
  private cap = 0;
  private used = 0;
  private dead = 0;
  private data = new Float32Array(0);
  private rowRecord: string[] = [];
  private rowChunk = new Int32Array(0);
  private rowStart = new Int32Array(0);
  private rowEnd = new Int32Array(0);
  private alive = new Uint8Array(0);
  private byRecord = new Map<string, number[]>();
  private versions = new Map<string, number>();
  private hashes = new Map<string, string>();

  get rows(): number {
    return this.used - this.dead;
  }

  get records(): number {
    return this.byRecord.size;
  }

  clear(): void {
    this.cap = 0;
    this.used = 0;
    this.dead = 0;
    this.data = new Float32Array(0);
    this.rowRecord = [];
    this.rowChunk = new Int32Array(0);
    this.rowStart = new Int32Array(0);
    this.rowEnd = new Int32Array(0);
    this.alive = new Uint8Array(0);
    this.byRecord.clear();
    this.versions.clear();
    this.hashes.clear();
  }

  private grow(need: number): void {
    if (this.used + need <= this.cap) return;
    let cap = Math.max(64, this.cap);
    while (cap < this.used + need) cap *= 2;
    const data = new Float32Array(cap * D);
    data.set(this.data.subarray(0, this.used * D));
    const chunk = new Int32Array(cap);
    chunk.set(this.rowChunk.subarray(0, this.used));
    const start = new Int32Array(cap);
    start.set(this.rowStart.subarray(0, this.used));
    const end = new Int32Array(cap);
    end.set(this.rowEnd.subarray(0, this.used));
    const alive = new Uint8Array(cap);
    alive.set(this.alive.subarray(0, this.used));
    this.data = data;
    this.rowChunk = chunk;
    this.rowStart = start;
    this.rowEnd = end;
    this.alive = alive;
    this.cap = cap;
  }

  private push(row: VectorRow): number {
    this.grow(1);
    const slot = this.used++;
    const v = row.vector;
    const n = Math.min(v.length, D);
    for (let k = 0; k < n; k++) this.data[slot * D + k] = v[k] ?? 0;
    this.rowRecord[slot] = row.recordId;
    const hash = row.id.lastIndexOf('#');
    this.rowChunk[slot] = hash >= 0 ? Number(row.id.slice(hash + 1)) || 0 : 0;
    this.rowStart[slot] = row.start;
    this.rowEnd[slot] = row.end;
    this.alive[slot] = 1;
    return slot;
  }

  async load(db: SieveDb, versions?: Map<string, number>): Promise<{ rows: number; orphans: string[]; stale: string[] }> {
    this.clear();
    const orphans: string[] = [];
    const stale: string[] = [];
    const rows: VectorRow[] = [];
    await db.vectors.each((row) => {
      if (versions) {
        const v = versions.get(row.recordId);
        if (v === undefined) {
          orphans.push(row.id);
          return;
        }
        if (v !== row.recordVersion || row.model !== EMBEDDING_MODEL) {
          stale.push(row.id);
          return;
        }
      }
      rows.push(row);
    });
    const grouped = new Map<string, VectorRow[]>();
    for (const r of rows) {
      const list = grouped.get(r.recordId) ?? [];
      list.push(r);
      grouped.set(r.recordId, list);
    }
    for (const [id, list] of grouped) this.upsertRecord(id, list);
    return { rows: this.rows, orphans, stale };
  }

  upsertRecord(recordId: string, rows: VectorRow[]): void {
    this.removeRecord(recordId);
    if (rows.length === 0) return;
    const slots: number[] = [];
    for (const r of rows) slots.push(this.push(r));
    this.byRecord.set(recordId, slots);
    const first = rows[0];
    if (first) {
      this.versions.set(recordId, first.recordVersion);
      if (first.inputHash) this.hashes.set(recordId, first.inputHash);
    }
  }

  removeRecord(recordId: string): void {
    const slots = this.byRecord.get(recordId);
    if (!slots) return;
    for (const s of slots) {
      if (this.alive[s]) {
        this.alive[s] = 0;
        this.dead++;
      }
    }
    this.byRecord.delete(recordId);
    this.versions.delete(recordId);
    this.hashes.delete(recordId);
    if (this.dead > 64 && this.dead > this.used * 0.25) this.compact();
  }

  has(recordId: string): boolean {
    return this.byRecord.has(recordId);
  }

  versionOf(recordId: string): number | undefined {
    return this.versions.get(recordId);
  }

  inputHashOf(recordId: string): string | undefined {
    return this.hashes.get(recordId);
  }

  recordIds(): string[] {
    return [...this.byRecord.keys()];
  }

  private compact(): void {
    let w = 0;
    const remap = new Map<number, number>();
    for (let r = 0; r < this.used; r++) {
      if (!this.alive[r]) continue;
      if (w !== r) {
        this.data.copyWithin(w * D, r * D, r * D + D);
        this.rowRecord[w] = this.rowRecord[r] ?? '';
        this.rowChunk[w] = this.rowChunk[r] ?? 0;
        this.rowStart[w] = this.rowStart[r] ?? 0;
        this.rowEnd[w] = this.rowEnd[r] ?? 0;
        this.alive[w] = 1;
      }
      remap.set(r, w);
      w++;
    }
    for (let r = w; r < this.used; r++) this.alive[r] = 0;
    this.rowRecord.length = w;
    this.used = w;
    this.dead = 0;
    for (const [id, slots] of this.byRecord) this.byRecord.set(id, slots.map((s) => remap.get(s) ?? s));
  }

  private dot(slot: number, q: Float32Array, qOff = 0): number {
    let s = 0;
    const base = slot * D;
    for (let k = 0; k < D; k++) s += (this.data[base + k] ?? 0) * (q[qOff + k] ?? 0);
    return s;
  }

  private hit(slot: number, score: number): ChunkHit {
    return {
      recordId: this.rowRecord[slot] ?? '',
      chunkIdx: this.rowChunk[slot] ?? 0,
      start: this.rowStart[slot] ?? 0,
      end: this.rowEnd[slot] ?? 0,
      score,
    };
  }

  scan(q: Float32Array, accept: (recordId: string) => boolean, topRecords: number): ChunkHit[] {
    const best = new Map<string, ChunkHit>();
    const accepted = new Map<string, boolean>();
    for (let slot = 0; slot < this.used; slot++) {
      if (!this.alive[slot]) continue;
      const id = this.rowRecord[slot] ?? '';
      let ok = accepted.get(id);
      if (ok === undefined) {
        ok = accept(id);
        accepted.set(id, ok);
      }
      if (!ok) continue;
      const score = this.dot(slot, q);
      const prev = best.get(id);
      if (!prev || score > prev.score) best.set(id, this.hit(slot, score));
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, topRecords);
  }

  similarTo(recordId: string, topRecords: number, accept: (id: string) => boolean): ChunkHit[] {
    const own = this.byRecord.get(recordId);
    if (!own || own.length === 0) return [];
    const q = new Float32Array(D);
    const best = new Map<string, ChunkHit>();
    for (const s of own) {
      q.set(this.data.subarray(s * D, s * D + D));
      for (const h of this.scan(q, (id) => id !== recordId && accept(id), Number.MAX_SAFE_INTEGER)) {
        const prev = best.get(h.recordId);
        if (!prev || h.score > prev.score) best.set(h.recordId, h);
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, topRecords);
  }
}

const indexes = new WeakMap<SieveDb, VectorIndex>();

export function getVectorIndex(db: SieveDb): VectorIndex {
  let ix = indexes.get(db);
  if (!ix) {
    ix = new MatrixIndex();
    indexes.set(db, ix);
  }
  return ix;
}

export function dropVectorIndex(db: SieveDb): void {
  indexes.get(db)?.clear();
  indexes.delete(db);
}

/** Vector bytes to and from base64 (the seed bundle's `v`, 20 section 18.2). */
export function vectorToBase64(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function vectorFromBase64(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
