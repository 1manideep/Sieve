// LabelExport (a testing tool, shown only at /sources?tool=labels): downloads how each Gmail item was sorted, one
// JSON object per line, to compare with labels made elsewhere. The file holds message ids, categories and who chose
// them. It never holds a subject, a sender or any text, and it is written on this computer only.
import { useState } from 'react';
import { Button } from '@/components/Button/Button';
import { tablesOf } from '@/components/dbTables';
import { SOURCES, fillText } from '@/copy/screens-controls';
import { formatCount } from '@/copy/format';
import type { SieveDb } from '@/index';
import ground from '../settings/kit/ground.module.css';
import kit from '../settings/kit/kit.module.css';

export const LABEL_EXPORT_FILE = 'sieve-labels.jsonl';

/** One line per Gmail item: its message id, its category, who chose it and whether its body has been read. */
export async function buildLabelExport(db: SieveDb): Promise<{ text: string; count: number }> {
  const lines: string[] = [];
  await tablesOf(db)
    .records.where('source')
    .equals('gmail')
    .each((r) => {
      const mark = r.enrich?.label;
      lines.push(
        JSON.stringify({
          id: r.id.slice('gmail:'.length),
          thread: r.threadId ?? null,
          category: r.category,
          by: r.categoryBy,
          label: mark ? { by: mark.by, confidence: mark.confidence ?? null, v: mark.v, attempts: mark.attempts ?? 0 } : null,
          body: r.text !== undefined,
        }),
      );
    });
  return { text: lines.join('\n') + (lines.length > 0 ? '\n' : ''), count: lines.length };
}

export function LabelExport({ db }: { db: SieveDb | null }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const download = async () => {
    if (!db) return;
    setBusy(true);
    try {
      const { text, count } = await buildLabelExport(db);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = LABEL_EXPORT_FILE;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(count);
    } catch (error) {
      console.error(error);
    }
    setBusy(false);
  };

  return (
    <section className={ground.band} aria-label={SOURCES.exportLabel}>
      <p className={kit.small}>{SOURCES.exportText}</p>
      <Button variant="secondary" size="sm" busy={busy} disabled={busy || !db} onClick={() => void download()}>
        {SOURCES.exportButton}
      </Button>
      {done !== null ? (
        <span className={kit.small} role="status">
          {fillText(SOURCES.exportDone, { n: formatCount(done), file: LABEL_EXPORT_FILE })}
        </span>
      ) : null}
    </section>
  );
}
