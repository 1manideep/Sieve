// /dev/seed (DEV builds only, 20 section 18.5): builds seed-bundle.json on this device with its own models and
// offers it as a download. The route is wired by the screens package; this page only runs buildSeedBundle.
import { useState } from 'react';
import { buildSeedBundle, SEED_VERSION, type BuildProgress } from './seed';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function DevSeedPage() {
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [result, setResult] = useState<{ json: string; records: number; vectors: number; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const t0 = performance.now();
    try {
      const bundle = await buildSeedBundle({ onProgress: setProgress });
      setResult({ json: JSON.stringify(bundle, null, 1) + '\n', records: bundle.records.length, vectors: bundle.vectors.length, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Build the Playground seed bundle</h1>
      <p>Seed version {SEED_VERSION}. This runs the embedder and the privacy checks on this computer, then gives you seed-bundle.json to commit. Bump the seed version after committing it.</p>
      <button type="button" onClick={() => void run()} disabled={busy}>{busy ? 'Building…' : 'Build seed bundle'}</button>
      {progress && <p>{progress.stage}: {progress.done} of {progress.total}</p>}
      {error && <p role="alert">Couldn't build the bundle: {error}</p>}
      {result && (
        <section>
          <p>{result.records} records and {result.vectors} vectors in {(result.ms / 1000).toFixed(1)} s.</p>
          <button type="button" onClick={() => download('seed-bundle.json', result.json)}>Download seed-bundle.json</button>
        </section>
      )}
    </main>
  );
}
