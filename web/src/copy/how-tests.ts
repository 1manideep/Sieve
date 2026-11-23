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
  /** The run failed, as when the on-device model ran past its time limit. */
  errors: number;
  /** An answer given to a question the mailbox cannot answer. */
  madeUp: number;
}

/** One blind set in one round. No run of these sets was declined or failed, so the counts sum to the set's questions. */
export type BlindRun = Pick<LiveRound, 'right' | 'wrong' | 'missed' | 'nothing' | 'madeUp'>;
export interface BlindRound {
  round: number;
  first: BlindRun;
  second: BlindRun;
}

export const TESTS = {
  /** `npm run check` at the last release, and the counts on a fresh copy of the repository on Nov 20, 2026. */
  automated: { tests: 2471, files: 197, testsOnNov20: 2047, functionsTests: 99, benchTests: 68 },
  /** Each risky step tried alone before the build, Nov 15 and 16, 2026: an M2 MacBook, 16 GB, sample data. */
  spikes: {
    labels: { right: 48, of: 50 },
    answers: { right: 4, of: 4, seconds: '9 to 11' },
    hidden: { right: 3, of: 3, seconds: 4 },
    captions: { firstRun: 4, secondRun: 5, of: 5, seconds: 4.6 },
    search: { byMeaning: 22, byKeyword: 18, of: 22 },
    typos: { right: 10, before: 7, of: 10 },
    emoji: { before: 1, after: 6, of: 6 },
    setupSeconds: 199,
  },
  /** The review of Nov 20, 2026: reviewers, and the findings it ranked (5 that stop a visitor, 10 critical, 20 high). */
  review: { reviewers: 7, ranked: 35 },
  /** The demo computer, Nov 17, 2026: a Mac with 16 GB, one answer of about 120 words per seat. */
  seats: { oneSeat: '5.2 to 5.6', firstWordsMs: 180, bothSeats: '8.4 to 8.8', modelGb: 3.8 },
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
      { name: 'Round 1, November 21', right: 5, wrong: 4, missed: 14, nothing: 9, declined: 0, errors: 5, madeUp: 0 },
      { name: 'Round 2, November 22', right: 20, wrong: 1, missed: 6, nothing: 10, declined: 0, errors: 0, madeUp: 0 },
      { name: 'Round 3, November 22', right: 23, wrong: 2, missed: 2, nothing: 10, declined: 0, errors: 0, madeUp: 0 },
      { name: 'Round 4, November 22', right: 20, wrong: 0, missed: 1, nothing: 7, declined: 8, errors: 1, madeUp: 0 },
      { name: 'Round 5, November 22', right: 24, wrong: 1, missed: 1, nothing: 10, declined: 1, errors: 0, madeUp: 0 },
      { name: 'Round 6, November 22', right: 25, wrong: 1, missed: 0, nothing: 10, declined: 1, errors: 0, madeUp: 0 },
      { name: 'Round 7, November 22', right: 22, wrong: 3, missed: 1, nothing: 10, declined: 1, errors: 0, madeUp: 0 },
      { name: 'Round 8, November 23', right: 25, wrong: 0, missed: 1, nothing: 9, declined: 1, errors: 1, madeUp: 0 },
      { name: 'Round 9, November 23', right: 23, wrong: 1, missed: 0, nothing: 8, declined: 1, errors: 2, madeUp: 2 },
      { name: 'Round 10, November 23', right: 24, wrong: 1, missed: 1, nothing: 10, declined: 1, errors: 0, madeUp: 0 },
    ] as readonly LiveRound[],
    /** The round the summary quotes (an index into rounds): the latest. */
    quoted: 9,
    /** The bar set before round 1, in percent: right and missed are shares of the answerable runs, wrong of the answers. */
    bar: { right: 85, missed: 10, wrong: 5 },
    /**
     * Two more sets asked in every round from round 6, written before any result from Sieve was seen, about emails the
     * 37 runs do not use. The first set was first asked in round 5, and that run is not counted here.
     */
    blind: {
      questions: 15,
      answerable: 12,
      absent: 3,
      /** The round in which each set was first asked, before any fix had looked at its misses. */
      firstAsked: [5, 6],
      rounds: [
        { round: 6, first: { right: 9, wrong: 0, missed: 3, nothing: 3, madeUp: 0 }, second: { right: 11, wrong: 0, missed: 1, nothing: 3, madeUp: 0 } },
        { round: 7, first: { right: 9, wrong: 0, missed: 3, nothing: 3, madeUp: 0 }, second: { right: 11, wrong: 0, missed: 1, nothing: 3, madeUp: 0 } },
        { round: 8, first: { right: 10, wrong: 0, missed: 2, nothing: 3, madeUp: 0 }, second: { right: 9, wrong: 1, missed: 2, nothing: 3, madeUp: 0 } },
        { round: 9, first: { right: 12, wrong: 0, missed: 0, nothing: 3, madeUp: 0 }, second: { right: 11, wrong: 0, missed: 1, nothing: 3, madeUp: 0 } },
        { round: 10, first: { right: 11, wrong: 0, missed: 1, nothing: 3, madeUp: 0 }, second: { right: 11, wrong: 0, missed: 1, nothing: 3, madeUp: 0 } },
      ] as readonly BlindRound[],
    },
  },
} as const;

/** Shown with the numbers, before the button: whose mailbox it was, and what was done to keep it private. */
export const PRIVACY =
  "The live rounds ran on the developer's own personal Gmail. To keep that mail private, only counts are published, and every name, number and example on this page, in the code and in its tests has been replaced with an invented one.";

const count = (n: number) => n.toLocaleString('en-US');
const share = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

const { automated, spikes, review, seats, search, model, live } = TESTS;
const { blind } = live;
const items = search.sample + search.unrelated;
const shipped = search.rows[search.rows.length - 1]!;
const first = live.rounds[0]!;
const quoted = live.rounds[live.quoted]!;
const answered = quoted.right + quoted.wrong;
const blindLatest = blind.rounds[blind.rounds.length - 1]!;
const blindSets = [blindLatest.first, blindLatest.second];

/** How many of the four parts of the bar one run of a question set met, given how many of its questions can be answered. */
export function barsMet(run: BlindRun, answerable: number): number {
  return [
    run.right * 100 >= live.bar.right * answerable,
    run.missed * 100 <= live.bar.missed * answerable,
    run.wrong * 100 <= live.bar.wrong * (run.right + run.wrong),
    run.madeUp === 0,
  ].filter(Boolean).length;
}
/** How many of the four parts of the bar the quoted round met. */
export const BARS_MET = barsMet(quoted, live.answerable);
/** The same for each blind set in its latest round. */
export const BLIND_BARS_MET = blindSets.map((set) => barsMet(set, blind.answerable));
const METS = ['none of the four', 'one of the four', 'two of the four', 'three of the four', 'all four'];
const MET = METS[BARS_MET]!;
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five'];
const roundOf = (r: LiveRound) => r.name.split(',')[0]!;

/** The latest round's runs over all three sets, the made-up answers among them, and the last round before it that had any. */
const latestRuns = live.runs + blindSets.length * blind.questions;
const latestMadeUp = quoted.madeUp + blindSets.reduce((sum, set) => sum + set.madeUp, 0);
const lastMadeUp = live.rounds.slice(0, live.quoted).findLast((r) => r.madeUp > 0);
const madeUpBefore = lastMadeUp ? ` ${roundOf(lastMadeUp)} had ${WORDS[lastMadeUp.madeUp] ?? lastMadeUp.madeUp}, and both causes were fixed.` : '';

/** A cell of Table 8: the answerable questions of one set in one round, and any made-up answer. */
const blindCell = (set: BlindRun) =>
  (
    [
      [set.right, 'right'],
      [set.wrong, 'wrong'],
      [set.missed, 'missed'],
      [set.madeUp, 'made up'],
    ] as const
  )
    .filter(([n], i) => i === 0 || n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(', ');
const blindLine = (set: BlindRun) =>
  `${set.right} of ${blind.answerable} right (${share(set.right, blind.answerable)}), ${set.missed} of ${blind.answerable} missed (${share(set.missed, blind.answerable)}), ${set.wrong === 0 ? 'no wrong answer' : `${set.wrong} wrong`} and ${set.madeUp === 0 ? 'nothing made up' : `${set.madeUp} made up`}`;
const [firstLine, secondLine] = blindSets.map(blindLine);
const [firstMet, secondMet] = BLIND_BARS_MET.map((n) => METS[n]!);
const blindMet = firstMet === secondMet ? `both sets met ${firstMet}` : `the first set met ${firstMet} and the second ${secondMet}`;
const blindHad = firstLine === secondLine ? `each set had ${firstLine}` : `the first set had ${firstLine}, and the second ${secondLine}`;
const [firstShare, secondShare] = blindSets.map((set) => share(set.right, blind.answerable));
const blindScored = firstShare === secondShare ? `${firstShare} each` : `${firstShare} and ${secondShare}`;
const [firstAsked, secondAsked] = blind.firstAsked;

const DETAIL: readonly HowBlock[] = [
  { h3: 'Automated tests' },
  {
    p: `**${count(automated.tests)} tests in ${automated.files} files** run before every release, with a type check, a lint pass, a size budget for every bundle and a scan of the repository for secrets. The model in these tests is a stand-in with scripted answers, so they check what Sieve's own code does with an answer: what is searched, what is refused, what is masked and what is written to a receipt. All of their data is invented. The database's access rules have their own tests, run against an emulator. On November 20 the count was ${count(automated.testsOnNov20)}, and on a fresh copy of the repository that day the relay's own functions passed ${automated.functionsTests} more tests and the bench ${automated.benchTests} self-tests.`,
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
      head: ['Round', 'Right', 'Wrong', 'Missed', 'Nothing, correctly', 'Made up', 'Declined', 'Errors'],
      rows: live.rounds.map((r) => [r.name, ...[r.right, r.wrong, r.missed, r.nothing, r.madeUp, r.declined, r.errors].map(String)]),
    },
  },
  {
    p: '**Wrong** is an answer from the wrong item, or the wrong fact from the right one. **Missed** is nothing returned although the mailbox held the answer. **Nothing, correctly** is nothing returned for a question the mailbox cannot answer. **Made up** is an answer to a question the mailbox cannot answer. **Declined** is a refusal with a reason.',
  },
  {
    p: "In round 4, Sieve's access to Gmail ran out during the test. It refused seven questions about the newest mail because it could not ask Gmail for newer mail, and it asked for a sender's name once. In round 5, and in every round from 6 to 10, it asked for a sender's name once. Round 8 had one error on the device. In round 9 the on-device model ran past its time limit twice, and two questions about things that are not in the mailbox got answers from unrelated emails. The causes of both made-up answers were fixed before round 10: a question that asks for a verification code now reads nothing at all, and a question about a named sender and a thing reads only that sender's emails that mention the thing. A timeout now gets one more try.",
  },
  {
    p: `The bar was set before the first round: right on at least ${live.bar.right}% of the answerable runs, missed on at most ${live.bar.missed}%, a wrong answer in at most ${live.bar.wrong}% of answers, and no made-up answer. ${roundOf(quoted)} met ${MET}: ${share(quoted.right, live.answerable)} right (${quoted.right} of ${live.answerable}), ${share(quoted.missed, live.answerable)} missed (${quoted.missed} of ${live.answerable}), ${share(quoted.wrong, answered)} wrong (${quoted.wrong} of ${answered} answers), and ${quoted.madeUp === 0 ? 'nothing' : WORDS[quoted.madeUp] ?? quoted.madeUp} made up.`,
  },
  {
    p: 'The fixes between rounds were general ones. The on-device model now suggests other words to search for. Plain code finds the newest email. A sender\'s name is matched inside an address that has no display name. A question about a day reads only that sender\'s mail of that day. And Sieve refuses a "latest" question when it cannot ask Gmail for newer mail.',
  },
  { p: 'The fixes after round 5 were general too:' },
  {
    ul: [
      'When the model answers a yes-or-no question with a sentence, one small call to the on-device model reads it as yes or no.',
      'The second check is skipped when plain code already knows the item is the one meant: the only item that holds the exact number the assistant gave, or the newest email from the sender the question names. On those items it had refused right answers.',
      'An answer is no longer cut short at an abbreviation, such as a short month name.',
      "A receipt that is only in an email's PDF attachment is read for that answer only, and never stored.",
      'A question that asks for a verification code reads nothing.',
      "A question that names a sender and asks about a thing reads only that sender's emails that mention the thing.",
      "A sender's own email comes before another service's notice about that sender.",
      'A timeout gets one more try.',
    ],
  },
  {
    p: `From round ${blind.rounds[0]!.round}, two more sets of ${blind.questions} questions were asked in every round. They were written before any result from Sieve was seen, about emails that the ${live.runs} runs above do not use. Each set has ${blind.answerable} questions the mailbox can answer and ${blind.absent} about things that are not in it. The first set began in round ${firstAsked}, and that run is not counted here. The second began in round ${secondAsked}.`,
  },
  {
    table: {
      caption: `Table 8 · Two blind sets of ${blind.questions} questions, by round`,
      head: ['Round', 'First set', 'Second set'],
      rows: blind.rounds.map((r) => [`Round ${r.round}`, blindCell(r.first), blindCell(r.second)]),
    },
  },
  {
    p: `In every round both sets returned nothing for their ${blind.absent} questions about things that are not in the mailbox. In round ${blindLatest.round} ${blindMet} parts of the bar: ${blindHad}. Their misses in earlier rounds were fixed too, so their later rounds are not blind either.`,
  },
  { h3: 'First measurements, before the build' },
  { p: 'Before the app was built, each risky step was tried alone on an M2 MacBook with 16 GB of memory, on sample data.' },
  {
    ul: [
      `**Categories.** Gemini Nano labelled ${spikes.labels.right} of ${spikes.labels.of} subject lines right, and every Health and Money one among them.`,
      `**Finding and answering.** It picked the right email and answered ${spikes.answers.right} times of ${spikes.answers.of}, in ${spikes.answers.seconds} seconds a question.`,
      `**Hidden instructions.** It flagged ${spikes.hidden.right} of ${spikes.hidden.of} planted instructions with no false alarm, in about ${spikes.hidden.seconds} seconds an item.`,
      `**Photo captions.** ${spikes.captions.firstRun} of ${spikes.captions.of} were accurate on the first run and ${spikes.captions.secondRun} of ${spikes.captions.of} on the second, in about ${spikes.captions.seconds} seconds each once the model was warm.`,
      `**Search.** Search by meaning put the right item in the best five for ${spikes.search.byMeaning} of ${spikes.search.of} questions, against ${spikes.search.byKeyword} for keywords alone. Typo correction fixed ${spikes.typos.right} of ${spikes.typos.of} misspelled questions, up from ${spikes.typos.before}.`,
      `**Emoji.** A subject line made only of emoji was found ${spikes.emoji.before} time of ${spikes.emoji.of}, and ${spikes.emoji.after} of ${spikes.emoji.of} once emoji were indexed by their names.`,
      `**First setup.** Gemini Nano took ${spikes.setupSeconds} seconds to become ready the first time.`,
    ],
  },
  { h3: 'A review from seven angles' },
  {
    p: `On November 20, ${review.reviewers} AI reviewers each read the public code and the live site from one angle: a strict hackathon judge, a security and privacy auditor, a web engineer, a backend engineer, an operations engineer, a UX reviewer and a reviewer of the hybrid AI design. They ran the real modules against their own scratch tests and probed the live site. The review ranked ${review.ranked} findings by severity and listed many smaller ones.`,
  },
  {
    p: 'Among those fixed since: a date read from a question no longer filters out the right item, "the latest" now reaches the newest email, signing out no longer hangs offline, the rate limit no longer fights the polling the tools ask for, and the content security policy now enforces. A second pass the same evening confirmed the first fixes in the code.',
  },
  {
    p: "The review also listed what held up. A person's own data cannot reach a cloud model, because those calls are fixed to the device inside the SDK. The database rules are per person. A connection that was turned off is refused on every call, and again when an answer is delivered.",
  },
  { h3: 'The demo computer' },
  {
    p: `Try on a real computer runs on one Mac with 16 GB of memory. With one seat asking, an answer of about 120 words took ${seats.oneSeat} seconds, and the first words came after about ${seats.firstWordsMs} milliseconds. With two seats asking at once it took ${seats.bothSeats} seconds. Each model used about ${seats.modelGb} GB while answering, so the computer offers two seats and not three.`,
  },
  { h3: 'What these tests do not show' },
  {
    ul: [
      '**One mailbox, one person, English.** Another mailbox will hold senders and wording these rounds never met.',
      `**Questions written after reading.** The assistant that wrote the questions had read the mailbox, and the same questions were asked again after each fix. Later rounds partly measure how well Sieve fits those questions. Two sets of ${blind.questions} were written before any result was seen, but their misses were fixed later too, so their later rounds partly measure fit as well. Each set was asked only once before any fix looked at its misses: the first in round ${firstAsked} and the second in round ${secondAsked}.`,
      '**Run to run.** The on-device model does not always answer the same way. A question can succeed in one run and return nothing in the next. In the latest rounds a few questions went from right to nothing and back again, with no change to Sieve that touched them.',
      '**Data that crosses.** How much less text reaches the cloud through Sieve than through direct access to the mailbox has not been measured yet.',
    ],
  },
];

export const TESTS_SECTION: HowSection = {
  id: 'tests',
  title: 'How Sieve is tested',
  blocks: [
    {
      p: 'Sieve is tested at four levels: automated tests on every change, a search benchmark on sample data, measurements of the on-device model, and live rounds in which an assistant asks about a real mailbox through the relay. Before those came first measurements of each risky step, and a review from seven angles. The numbers are from November 2026.',
    },
    {
      stats: [
        { value: count(automated.tests), label: 'automated tests pass before every release' },
        { value: `${shipped.bestFive}%`, label: `of search questions find the right item in the best five, among ${count(items)} items` },
        {
          value: `${quoted.right} of ${live.answerable}`,
          label: `answerable questions answered right in the latest live round on a real mailbox. The first round scored ${first.right}.`,
        },
        { value: String(latestMadeUp), label: `made-up answers in the latest round, across its ${latestRuns} runs.${madeUpBefore}` },
      ],
    },
    { note: PRIVACY },
    {
      p: `The live rounds are small and come from one mailbox, and the same questions were asked again after each fix. Two sets of questions written before any result was seen scored ${blindScored} in the latest round. Read the rounds as progress, not as a guarantee. Every round, table and caveat is one click away.`,
    },
    { more: { show: 'Show all the tests', hide: 'Hide the tests', blocks: DETAIL } },
  ],
};
