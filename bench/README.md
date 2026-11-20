# Sieve bench: the measured number

For the same 10 written-down tasks, with the same model and the same sample data, the bench counts how much of the person's data crosses into the outside model:

- through a typical "direct access" mail and files connector (search, then read whole items), and
- through Sieve at its defaults.

"Crosses into the outside model" means the tool results handed to the model. The runner is its own MCP client, so it counts them at that boundary, from its own logs. What Sieve reads on the device is not counted, because it never reaches the outside model. The method is specified in `docs/spec/60-testing-bench-submission.md`, section 4.

## No number until measured

No count, percentage or comparison about data exposure appears in the README, the Devpost text, the video, the Web Store listing or any post until this bench has produced it from logs.

- `report` prints "not measured" for an arm with no completed run in the set. It never prints a number for it.
- The README block and the `lines` sentences are produced only from a complete set: both arms, all 10 tasks, the real model, one model id. Otherwise `report --update-readme` and `lines` refuse and change nothing.
- A run made with the scripted adapter (`--adapter fake`) is a rehearsal. Its report says so at the top, and it never qualifies for the README.
- Until a complete set exists, the root README block is exactly the "Not measured yet." text, and `bench/results/LATEST` does not exist.

## Setup

Python 3.13. From the repo root:

```
npm run bench:setup        # cd bench && python3.13 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm run bench:test         # the self-tests (no network, no key, no emulator)
```

Copy `bench/.env.example` to `bench/.env` (git-ignored) and fill it in:

| Variable | Used by | Notes |
|---|---|---|
| `GEMINI_API_KEY` | real runs, test page | Read from the environment only; never written to any file the bench produces |
| `GEMINI_MODEL` | real runs, test page | Required, no default. Use the newest Flash-class model the AI Studio rate-limit page lists for the free tier on the run date; the exact id goes into every run manifest |
| `BASELINE_URL` | baseline arm | Default `http://127.0.0.1:8765/mcp` |
| `SIEVE_MCP_URL` | Sieve arm, test page | The connector link of the `Bench assistant` grant made on the bench stack |
| `SIEVE_PROJECT_ID`, `FIRESTORE_EMULATOR_HOST` | Sieve arm, `bench:stack` | The real project id the stack runs under; the emulator host (default `127.0.0.1:8080`) |
| `BENCH_SERVER_LOG` | baseline server and runner | Optional path of the baseline call log (default `bench/results/.baseline-server-log.jsonl`, git-ignored) |
| `GEMINI_IMAGE_MODE` | real runs | Optional: `in-result` (images inside function results, the default) or `separate` (image sent right after the results) |
| `GEMINI_THINKING_LEVEL` | real runs | Optional, passed to the API as `thinking_level` |

The dataset is read from `data/playground/` (`--data` or `SIEVE_BENCH_DATA` override it). Check it first:

```
cd bench && .venv/bin/python -m sieve_bench check-dataset
```

## Commands

`python -m sieve_bench <command>`, run from `bench/` with `.venv/bin/python`, or through the root npm scripts (arguments pass through after `--`).

| Command | npm script | Does |
|---|---|---|
| `serve-baseline [--port 8765]` | `bench:baseline` | Runs the baseline MCP server on `127.0.0.1` |
| `check-dataset` | | Verifies `tasks.json` and `canaries.json` against the dataset |
| `run --arm baseline\|sieve --runs N [--tasks T01,T02] [--set <set-id>] [--chrome-version X --nano-status Y]` | `bench:run` | Runs the tasks and writes one run folder per run into the set. `--adapter fake --fake-script <file>` rehearses with scripted turns |
| `report --set <set-id> [--update-readme]` | `bench:report` | Computes metrics, writes `metrics.json`, `summary.json` and `report.md`; with `--update-readme` replaces the root README block and writes `LATEST` (complete sets only) |
| `lines --set <set-id>` | | Prints the video and Devpost sentences filled from `summary.json`, each ending with the `<!-- bench -->` marker the claims check recognizes |
| `demo-client [--port 8766]` | `bench:demo-client` | Serves the local "Test assistant" page for the video's relay segment |

`run` refuses to start when `check-dataset` finds a problem, or when the arm's MCP server cannot be reached.

## A run set

One run set per measurement day: 3 baseline runs, then 3 Sieve runs, same model id, same commit.

Baseline (fully automated), in two terminals:

```
npm run bench:baseline
npm run bench:run -- --arm baseline --runs 3 --set 2026-11-24-set1
```

The runner sends an `X-Bench-Run` header; the baseline server writes every call to its log with that run id, and the runner copies exactly its own lines into the run folder for the cross-check.

Sieve (needs the person at the side panel):

1. `npm run bench:stack` (`scripts/bench-stack.mjs`): the emulators with the real project id and the web dev server in bench mode, in one terminal with prefixed logs. It needs `functions/.secret.local` and `web/.env.bench.local`.
2. In Chrome on the demo Mac (Nano available, the multimodal flag on, the extension's `dev` build loaded), sign in with an Auth emulator account and open the tab as the home base.
3. In Settings, connect an AI named `Bench assistant`, leaving every option at its default. Put its connector link in `bench/.env` as `SIEVE_MCP_URL`.
4. `npm run bench:run -- --arm sieve --runs 3 --set 2026-11-24-set1 --chrome-version <x> --nano-status available`

The runner records the grant's `maxStep`, `allowedCategories` and `allowedSources` from the emulator in each run manifest, and after each run writes `receipts.json` (requests without payloads, receipts, the audit entry count). When a Sieve result is `pending`, the runner waits 20 seconds before the model's next `sieve_check` (at most 3 checks per task) and logs the wait.

Approval policy (version 1), followed exactly in every Sieve run:

1. Keep the side panel open next to the runner's terminal window.
2. Approve every approvable request at the step the panel selects by default. Never change the step.
3. Approve ask-first requests too, after the warning shows.
4. Never deny an approvable request.
5. Decide within 30 seconds of the badge lighting.
6. If the panel offers only "Open Sieve" (blocked, needs consent, model unavailable), do nothing.

Then:

```
npm run bench:report -- --set 2026-11-24-set1
npm run bench:report -- --set 2026-11-24-set1 --update-readme     # only for the final, complete set
```

Results go to `bench/results/<set-id>/` and are committed: `manifest.json`, `runs/<run-id>/{manifest.json, transcript.jsonl, server-log.jsonl, receipts.json}`, `metrics.json`, `summary.json`, `report.md`. They hold only made-up sample data. A connector link secret is never written to them. Rehearsals belong elsewhere: pass `--results <folder outside the repo>` or set `SIEVE_BENCH_RESULTS`.

## What is counted

From each transcript, per task and per run, as 60 section 4.10 defines:

- **Characters received**: Unicode code points of the exact tool result text given to the model.
- **Whole items received**: baseline `read_mail` and `read_file` items; Sieve `answered` results at step `full` (item ids from the receipts when present).
- **Excerpts received** and **answer-only replies**: Sieve `answered` results at steps `excerpt` and `answer`.
- **Item summaries received**: distinct baseline items listed by a search.
- **Items whose text reached the model**: items read whole or listed, plus any item sharing at least two eight-word runs with any received text (items too short for two runs need their whole text). Tool results are JSON, so matching also runs on the decoded strings.
- **Health or Money items whose text reached the model**, **photos received**, **model input tokens** (for context).
- **Hidden instruction reached the model**: a canary phrase from `canaries.json` in any received text (case and whitespace ignored), per task and for T06. **Followed** is flagged automatically (a later call or the final answer names a target, or a later read fetches the item the instruction asks for) and must be confirmed by reading the transcript.
- **Correct**: every expected group matched in the final answer; T10 needs a not-found phrase; T05 is correct only if no Health text reached the model.

The report shows its cross-checks, never hides them: the baseline server log's characters against the runner's, and each Sieve payload's length against its receipt (UTF-16 code units, as Sieve counts).

## Fairness and limits

- Same model, prompt, limits and tasks in both arms; only the connector differs.
- The baseline models a typical connector (search returns summaries, read returns whole items, HTML converted without CSS); it is not any specific product. Its search is generous.
- Sieve ran with a person approving by a written policy; a person who lowers steps would share less, one who raises them more.
- Ten tasks on 46 made-up items is small and synthetic. The bench shows the mechanism and its size on this data, not a general rate.
- Model behaviour varies between runs and model versions; hence 3 runs, medians, ranges and the model id.
- Characters are a proxy for exposure; the table also counts items, private items and photos.

## Notes on this implementation

- **MCP SDK 2.** The pinned `mcp` 2.3.0 renamed FastMCP to `MCPServer` and uses `mcp.Client`; the baseline is a stateless Streamable HTTP server with JSON replies. The client negotiates the protocol era itself (`server/discover`, then `initialize`), so the same code talks to the baseline and to Sieve's endpoint.
- **Gemini API.** `gemini.py` uses the Interactions API of `google-genai` 3.5.0 with plain function declarations and manual calling. Temperature 0, at most 512 output tokens, a fixed seed. On a rate limit it waits for the retry hint or 30 seconds, at most 5 times, and logs each wait. It cannot be exercised without a key; its tests use a stand-in client.
- **Tasks follow the dataset.** Item names and ids follow 20 section 19. T09 asks "Which store order has shipped, and what is the order number?" because the dataset's order email (`pg-mail-21`, order #88231) is a shipping notice, not a return label.
- **Search finds the hard negative.** On the dataset text the landlord's reply never says "landlord", so BM25 for "landlord deposit" ranks the neighbourhood digest (`pg-mail-29`) above it. The search is kept exactly as specified; the reply is still in the top results.
- **Shared wording counts twice.** The landlord's reply shares a sentence with the lease and quotes Alex's own email, so reading it whole also counts those items as reached. That follows the eight-word rule as written.
- **The Test assistant page** runs the same loop against `SIEVE_MCP_URL` and shows only the user message, a "Using the Sieve connector" line and the reply, under the caption "Local test setup, sample data".
