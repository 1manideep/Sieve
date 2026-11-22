// The numbers and the words of "How Sieve is tested" on /how. Every number in that section comes from TESTS, so a new
// round of tests is one edit here. The live rounds ran on the developer's own personal mailbox, so their results are
// counts only: no question, answer, sender or subject from that mailbox is written here or anywhere else in the
// repository, and the page says so (PRIVACY). No em dashes anywhere.
import type { HowBlock, HowSection } from './screens-how';

export interface LiveRound {
  name: string;
  right: number;
  /** Answered from an item that does not hold the answer. */
  wrong: number;
  /** Nothing returned, though the mailbox held the answer. */
  missed: number;
  /** Nothing returned for a question the mailbox cannot answer. */
  nothing: number;
  /** Refused with a reason: the sender was not named, or Gmail could not be asked for newer mail. */
  declined: number;
  errors: number;
}

export const TESTS = {
  /** `npm run check` at the last release. */
  automated: { tests: 2361, files: 185 },
  /** bench/search-eval, Nov 22, 2026: the sample items mixed with unrelated public emails. Percent of questions. */
  search: {
    questions: 68,
    sample: 46,
    unrelated: 1974,
    rows: [
      { setup: 'Meaning and keywords', first: 66, bestFive: 90 },
      { setup: 'With the reranker', first: 74, bestFive: 91 },
      { setup: 'With other search words from the on-device model', first: 81, bestFive: 93 },
      { setup: 'With both, as Sieve runs', first: 75, bestFive: 96 },
    ],
  },
  /** Gemini Nano in Chrome on a MacBook, prompts built by the app's own code (Nov 21 and 22, 2026). */
  model: {
    lookalikes: { right: 19, of: 20, rightWithSeven: 16 },   // given five items, and given seven
    newest: { right: 4, of: 5, rightAlone: 5 },
    wordsSeconds: 1.2,
    prompt: { longChars: 9000, longSeconds: 23, shortChars: 6000, shortSeconds: 4 },
  },
  /** Rounds on one real mailbox, asked through the relay with approval set to automatic. */
  live: {
    runs: 37,
    answerable: 27,
    absent: 10,
    rounds: [
      { name: 'Round 1, November 21', right: 5, wrong: 4, missed: 14, nothing: 9, declined: 0, errors: 5 },
      { name: 'Round 2, November 22', right: 20, wrong: 1, missed: 6, nothing: 10, declined: 0, errors: 0 },
      { name: 'Round 3, November 22', right: 23, wrong: 2, missed: 2, nothing: 10, declined: 0, errors: 0 },
      { name: 'Round 4, November 22', right: 20, wrong: 0, missed: 1, nothing: 7, declined: 8, errors: 1 },
    ] as readonly LiveRound[],
    /** The round the summary quotes (an index into rounds): the last one in which Gmail stayed connected. */
    quoted: 2,
    /** Runs since round 1 of questions the mailbox cannot answer, and how many of them got an answer. */
    absentRuns: 27,
    madeUp: 0,
  },
} as const;

/** Shown with the numbers, before the button: whose mailbox it was, and what was done to keep it private. */
export const PRIVACY =
  "The live rounds ran on the developer's own personal Gmail. To keep that mail private, only counts are published, and every name, number and example on this page, in the code and in its tests has been replaced with an invented one.";

const count = (n: number) => n.toLocaleString('en-US');
const share = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

const { automated, search, model, live } = TESTS;
const items = search.sample + search.unrelated;
const shipped = search.rows[search.rows.length - 1]!;
const first = live.rounds[0]!;
const quoted = live.rounds[live.quoted]!;
const answered = quoted.right + quoted.wrong;

const DETAIL: readonly HowBlock[] = [
  { h3: 'Automated tests' },
  {
    p: `**${count(automated.tests)} tests in ${automated.files} files** run before every release, with a type check, a lint pass, a size budget for every bundle and a scan of the repository for secrets. The model in these tests is a stand-in with scripted answers, so they check what Sieve's own code does with an answer: what is searched, what is refused, what is masked and what is written to a receipt. All of their data is invented. The database's access rules have their own tests, run against an emulator.`,
  },
  { h3: 'Search benchmark' },
  {
    p: `The benchmark asks ${search.questions} questions about the sample data, each with the item that answers it: direct questions, questions worded differently from the item, typos, dates and "the latest" questions. The ${search.sample} sample items are mixed with ${count(search.unrelated)} unrelated emails from a public corpus, so the right item has to be found among ${count(items)}.`,
  },
  {
    table: {
      caption: `Table 6 · Search benchmark: ${search.questions} questions among ${count(items)} items`,
      head: ['Search', 'Right item first', 'Right item in the best five'],
      rows: search.rows.map((row) => [row.setup, `${row.first}%`, `${row.bestFive}%`]),
    },
  },
  {
    p: 'Sieve reads the best five items, so the last column decides whether the model sees the right one. The settings were tuned on these same questions, so new questions will score lower. The benchmark is in the repository under `bench/search-eval` and runs with one command.',
  },
  { h3: 'The on-device model' },
  { p: "Gemini Nano was measured in Chrome on a MacBook, with prompts built by the app's own code." },
  {
    ul: [
      `**Choosing among lookalikes.** Given five similar items, it picked the right one ${model.lookalikes.right} times of ${model.lookalikes.of}. Given seven, ${model.lookalikes.rightWithSeven} of ${model.lookalikes.of}. Sieve reads five.`,
      `**The newest email.** Given several emails from one sender, newest first, it answered from the newest ${model.newest.right} times of ${model.newest.of}. Given only the newest, ${model.newest.rightAlone} of ${model.newest.of}. So plain code finds the newest and the model reads only that one.`,
      `**Other search words.** About ${model.wordsSeconds} seconds for one question.`,
      '**The second check.** It stops about half of the answers taken from an item that only looks right. The other half reach the person, who reads the text before it leaves.',
      `**Long prompts.** A prompt of ${count(model.prompt.longChars)} characters took ${model.prompt.longSeconds} seconds, and one of ${count(model.prompt.shortChars)} took ${model.prompt.shortSeconds}. Sieve keeps its prompt near the smaller size.`,
    ],
  },
  { h3: 'Live rounds on a real mailbox' },
  {
    p: `The last level is the whole path. An assistant connected through the relay asks questions about a real Gmail mailbox, with approval set to automatic for the test, and then checks every answer against the mailbox itself. A round is ${live.runs} runs: ${live.answerable} of questions the mailbox can answer and ${live.absent} of questions about things that are not in it. The questions ask for an amount on a receipt, a booking found by its number, the newest email from a sender, what a sender wrote on a given day, and things described in words the email does not use.`,
  },
  {
    table: {
      caption: `Table 7 · Live rounds, ${live.runs} runs each`,
      head: ['Round', 'Right', 'Wrong item', 'Missed', 'Nothing, correctly', 'Declined', 'Errors'],
      rows: live.rounds.map((r) => [r.name, ...[r.right, r.wrong, r.missed, r.nothing, r.declined, r.errors].map(String)]),
    },
  },
  {
    p: "**Missed** is nothing returned although the mailbox held the answer. **Nothing, correctly** is nothing returned for a question the mailbox cannot answer. **Declined** is a refusal with a reason. In round 4, Sieve's access to Gmail ran out during the test. It refused seven questions about the newest mail because it could not ask Gmail for newer mail, and it asked for a sender's name once.",
  },
  {
    p: `The bar was set before the first round: right on at least 85% of the answerable runs, missed on at most 10%, a wrong item in at most 5% of answers, and no made-up answer. ${quoted.name.split(',')[0]} met three of the four: ${share(quoted.right, live.answerable)} right (${quoted.right} of ${live.answerable}), ${share(quoted.missed, live.answerable)} missed (${quoted.missed} of ${live.answerable}), nothing made up, and ${share(quoted.wrong, answered)} wrong (${quoted.wrong} of ${answered} answers).`,
  },
  {
    p: 'The fixes between rounds were general ones. The on-device model now suggests other words to search for. Plain code finds the newest email. A sender\'s name is matched inside an address that has no display name. A question about a day reads only that sender\'s mail of that day. And Sieve refuses a "latest" question when it cannot ask Gmail for newer mail.',
  },
  { h3: 'What these tests do not show' },
  {
    ul: [
      '**One mailbox, one person, English.** Another mailbox will hold senders and wording these rounds never met.',
      '**Questions written after reading.** The assistant that wrote the questions had read the mailbox, and the same questions were asked again after each fix. Later rounds partly measure how well Sieve fits those questions. A new set, written without seeing the fixes, has not been run.',
      '**Run to run.** The on-device model does not always answer the same way. A question can succeed in one run and return nothing in the next.',
      '**Data that crosses.** How much less text reaches the cloud through Sieve than through direct access to the mailbox has not been measured yet.',
    ],
  },
];

export const TESTS_SECTION: HowSection = {
  id: 'tests',
  title: 'How Sieve is tested',
  blocks: [
    {
      p: 'Sieve is tested at four levels: automated tests on every change, a search benchmark on sample data, measurements of the on-device model, and live rounds in which an assistant asks about a real mailbox through the relay. The numbers are from November 2026.',
    },
    {
      stats: [
        { value: count(automated.tests), label: 'automated tests pass before every release' },
        { value: `${shipped.bestFive}%`, label: `of search questions find the right item in the best five, among ${count(items)} items` },
        {
          value: `${quoted.right} of ${live.answerable}`,
          label: `answerable questions answered right in a live round on a real mailbox. The first round scored ${first.right}.`,
        },
        { value: String(live.madeUp), label: `made-up answers in ${live.absentRuns} runs of questions the mailbox cannot answer` },
      ],
    },
    { note: PRIVACY },
    {
      p: 'The live rounds are small and come from one mailbox, and the same questions were asked again after each fix. Read them as progress, not as a guarantee. Every round, table and caveat is one click away.',
    },
    { more: { show: 'Show all the tests', hide: 'Hide the tests', blocks: DETAIL } },
  ],
};
