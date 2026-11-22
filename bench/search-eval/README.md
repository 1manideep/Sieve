# Offline search eval

A repeatable check of how well Sieve's on-device search puts the right item first. It runs the app's own code
(`web/src/index/search.ts`, the ingest queue, the date parser, prepareProposal's "latest" ordering) in the web test
environment, with the real embedding model the app uses: `Xenova/all-MiniLM-L6-v2` q8, mean pooling, normalized,
through `@huggingface/transformers` in a Node child process (`tests/harness/nodeEmbedder.ts`, the same one the
real-model unit tests use).

It is not part of `npm run check` and never downloads anything there.

## Run it

From the repository root:

```sh
npm run eval:search                         # seed items, then seed items plus distractor mail; reranker "did not run"
npm run eval:search -- --seed-only          # the 46 seed items only, no download
npm run eval:search -- --rerank none,model  # also with the app's reranker model (downloads about 23 MB once)
npm run eval:search -- --rerank model --rerank-limit 12 --rerank-tokens 192   # as on one WASM thread
npm run eval:search -- --rerank model --rerank-limit 20 --rerank-tokens 320   # as on WebGPU
npm run eval:search -- --sweep my-grid.json # compare settings of SEARCH_TUNING (web/src/index/config.ts)
npm run eval:search -- --extra my-mail.json --depth 50   # your own emails and questions, from a file outside the repo
npm run eval:search -- --clean              # delete the temp folder with the downloads and caches
```

It prints a table of recall at 1, 3 and 5 and MRR per set and setting, and the questions that missed. Per-question
results go to `last-run.json` in the temp folder (`--out` to change it).

A sweep file is a list of settings, each applied on top of the values in `SEARCH_TUNING`:

```json
[{ "label": "rrf k 5", "tuning": { "rrfK": 5 } }, { "label": "rrf k 60", "tuning": { "rrfK": 60 } }]
```

`--extra` adds emails of your own after the other sets and asks your questions of them, so a miss seen on real mail
can be reproduced. The file is `{ "items": [{ "id", "title", "from", "date", "text" }], "questions": [{ "id", "type",
"q", "answers": ["an item id"], "hints" }] }`, with `date` as an ISO time near the Playground clock. Keep it outside the
repository. `--depth` asks for and scores that many candidates instead of the app's 7, to see how far down a missed
item sits.

## What it needs

- The MiniLM files in `spikes/search/.model-cache` (the same cache the real-model unit tests read).
- For the distractor set, network access once: 2,000 public emails from the Enron spam corpus
  (`SetFit/enron_spam`, `test.jsonl`, about 6 MB) are downloaded into the temp folder (`$TMPDIR/sieve-search-eval`,
  or `SIEVE_EVAL_CACHE`), never into the repository. Nobody's own mail is used.
- For `--rerank model`, network access once: the app's reranker model, `Xenova/ms-marco-MiniLM-L-6-v2` q8
  (`web/src/ml/protocol.ts`), into the same temp folder (`--rerank-model` picks another). It runs in Node on the
  native runtime and answers the reranker's contract (`web/src/index/rerank.ts`) the way the app's does: fewer than 4
  passages are not reranked, and with `--rerank-limit 12` only the first 12 are scored and the rest keep their place,
  as on one WASM thread within the 1.5 s budget. The app runs the same model as fp16 on WebGPU; the eval uses q8 for
  both cases, with the token cap of each (`--rerank-tokens`). The eval gives it all the time it needs, so the rows
  measure order, not this machine's speed.

## The data and the questions

- The 46 Playground seed items (30 emails, 6 documents, 10 photos) from the committed seed bundle, exactly as the
  Playground seeds them, with the Playground clock (Tue Nov 17, 2026).
- The distractor set adds the 1,974 non-empty Enron emails through the app's ingest and queue (code labels, the
  Health safety net, chunking, embedding). They get made-up senders and dates spread over the same weeks as the seed
  mail (Sep 3 to Nov 16), so a recency boost cannot tell them apart from the seed items.
- `questions.json`: 70 questions written before any tuning, each with the items that answer it: paraphrases with
  no shared words, direct questions, exact identifiers, senders, "latest", dates (written out with a year, a month and
  day without one, relative, a bare weekday, and misleading words like "in the sun"), typos, and five questions with
  the hints an outside assistant would send. Two questions are left out of the distractor set (`seedOnly`), because
  work mail and newsletters among the distractors could honestly answer them.

## How it asks and scores

Each question goes through `search()` the way prepareProposal sends it: an in-app question parsed first (the corrected
text, the parsed hints prepareProposal passes on), an outside assistant's question with its hints as given. The order
scored is the one the answer step reads: the first `SELECT_MAX_PASSAGES` (7) candidates, newest first when the
question asks for the latest. Items the rules hold back (Health, one-time codes) stay in the list, so this measures
retrieval, not the share decision. A hit is any listed answer item; MRR is over those 7.

With 70 questions, one question is about 1.4 points of recall; differences under about 5 points are within noise.
