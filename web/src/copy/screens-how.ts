// Copy for /how, "How Sieve works": the hero, the video card, the paper's 15 sections and the words in its figures.
// It lives apart from screens-main.ts so it loads with the /how route only, never with the landing.
// In the paper's text, **words** are drawn as strong and `words` as code; the screen renders both as elements, never
// as HTML. All sample text is invented. No em dashes anywhere.

/** A chip in a table cell, with optional text after it. */
export interface HowChip {
  chip: string;
  tone?: 'device' | 'person' | 'cloud';
  after?: string;
}
export type HowCell = string | HowChip;
/** A list item, or an item with a list of its own. */
export type HowListItem = string | { text: string; items: readonly string[] };
/** A table. A blank first heading marks a column of step numbers. */
export interface HowTable {
  caption: string;
  head: readonly string[];
  rows: readonly (readonly HowCell[])[];
}
export type HowFigure = 'architecture' | 'steps' | 'ladder' | 'relay';
export type HowBlock =
  | { p: string }
  | { h3: string }
  | { ul: readonly HowListItem[] }
  | { ol: readonly HowListItem[] }
  | { note: string }
  | { table: HowTable }
  | { figure: HowFigure }
  | { next: true };
export interface HowSection {
  id: string;
  title: string;
  blocks: readonly HowBlock[];
}

export const HOW_COPY = {
  lead: 'An AI assistant sends a question. Gemini Nano finds the answer in your mail, files and photos, on your own computer. One line leaves, after you approve it.',
  status:
    'This content was last updated in November 2026 and describes Sieve as it was built at that time. Sieve is under active development, and the details below may change.',
  video: {
    label: 'Video placeholder: How Sieve works, in 3 minutes. The video is coming soon.',
    title: 'How Sieve works (in 3 minutes)',
    soon: 'Video coming soon',
    mail: 'mail',
    files: 'files',
    photos: 'photos',
    line: 'one approved line',
  },
  onThisPage: 'On this page',
  /** The hidden heading of Table 2's step numbers. */
  number: 'Number',
  source: 'Read the source',
  figures: {
    architecture: {
      label:
        "The question enters the person's computer from the relay. Mail, files and photos are indexed and read there by Gemini Nano. Only the approved text crosses back to the relay and the assistant.",
      device: "The person's computer (Chrome)",
      cloud: 'Cloud (Firebase)',
      boxes: [
        ['Mail, files, photos', 'read on this computer'],
        ['Private index', 'vectors and keywords'],
        ['Gemini Nano', 'finds, reads, answers'],
        ['Approval', 'the exact text'],
        ['Relay', 'holds requests'],
        ['AI assistant', 'any MCP client'],
      ],
      indexed: 'indexed here',
      five: 'the best five items',
      sentence: 'one sentence',
      question: 'the question',
      approved: 'approved text',
      caption: [
        'Figure 1',
        'The question goes in, and one approved text comes out. Everything that reads private data sits on the left. Gmail is read from the browser with read-only access.',
      ],
    },
    steps: {
      label:
        'Ten steps in three lanes. Plain code reads the question, searches, applies rules, checks and masks. The on-device model suggests other words, reads and answers, and checks. The person approves the exact text, and only then does text leave the device.',
      lanes: ['Plain code', 'On-device model', 'The person'],
      steps: [
        'Read the question',
        'Think of other words',
        'Search by meaning and keyword',
        'Apply rules, put in order',
        'Read five items, answer',
        'Check shape and freshness',
        'Check the item really answers',
        'Mask personal details',
        'Last look for personal details',
        'Approve the exact text',
      ],
      leaves: 'Approved text leaves the device',
      caption: [
        'Figure 2',
        'The steps of one request. Every step above the last line runs on the person\'s computer. A request can stop at any step before the last and return "Nothing to share for that."',
      ],
    },
    ladder: {
      slips: [
        { title: 'Answer', cap: 'The default. One sentence, at most 300 characters.', text: 'Your deposit was $1,200, paid on March 3.' },
        {
          title: 'Excerpt',
          cap: 'The lines that hold the answer, copied by plain code.',
          text: 'I received your security deposit of $1,200 on March 3. I will return it within 30 days of move-out. [name]',
        },
        {
          title: 'Full item',
          cap: 'The whole item, with personal details masked.',
          text: 'From: [name] <[email]>\nSubject: Re: Deposit for the apartment\n\nHi [name], I received your security deposit of $1,200 on March 3. I will return it within 30 days of move-out. Call me on [phone] if anything comes up. …',
        },
      ],
      caption: ['Figure 3', 'What leaves at each step, for "What did my landlord say about the deposit?" The text is sample data.'],
    },
    relay: {
      label:
        "Sequence: the assistant calls the relay with a question. The relay passes the request to the home base on the person's computer, which searches, reads, checks and masks. The person sees the exact text and approves. Only the approved text returns through the relay to the assistant.",
      device: "On the person's computer",
      actors: ['AI assistant', 'Relay', 'Home base', 'The person'],
      messages: ['sieve_answer(question)', 'the request', 'the exact text', 'approve', 'approved text only', 'the answer'],
      work: 'search, read, check, mask',
      kept: 'text deleted, receipt kept',
      caption: [
        'Figure 4',
        'One request through the relay. The relay sees the question and, briefly, the approved text. It never sees the items that were searched or read.',
      ],
    },
  },
} as const;

const DEVICE_ONLY: HowChip = { chip: 'On device only', tone: 'device' };
const PLAIN_CODE: HowChip = { chip: 'Plain code' };
const ON_DEVICE: HowChip = { chip: 'On-device model', tone: 'device' };

export const HOW_SECTIONS: readonly HowSection[] = [
  {
    id: 'introduction',
    title: 'Introduction',
    blocks: [
      {
        p: "Sieve lets an AI assistant answer questions about a person's email, files and photos without being given access to them. The assistant sends a question. A small model on the person's own computer finds the item that answers it and writes one sentence. The person sees that sentence and decides whether it leaves.",
      },
      {
        p: 'This document is for people who are deciding whether to connect an assistant to their own data, and for engineers who want to know how the parts fit together. It describes the following:',
      },
      {
        ul: [
          "Where a person's data is stored and processed, and what crosses to the cloud.",
          'How Sieve builds a private index on the device.',
          'How one question becomes one approved answer.',
          {
            text: 'The controls that limit what is shared:',
            items: [
              'The need-to-know ladder',
              'Category rules',
              'Removal of hidden instructions and masking of personal details',
              'Approval of the exact outgoing text',
            ],
          },
          'How an outside assistant reaches Sieve through the relay.',
          'What Sieve records, and what it cannot do yet.',
        ],
      },
    ],
  },
  {
    id: 'summary',
    title: 'Summary',
    blocks: [
      {
        ul: [
          "Email, files, photos and the search index stay on the person's computer. Sieve's servers never receive them.",
          "Gemini Nano, running inside Chrome, finds the item and writes the answer. Calls on a person's own data are made in on-device-only mode.",
          'By default an assistant receives one sentence of at most 300 characters, written from one item.',
          'Nothing is sent until the person approves the exact text. The person can always share less than was asked for.',
          'Items in a category marked **Never share** are removed before any model reads them. Health is in that group by default.',
          'An assistant gets the same reply whether an item was blocked or does not exist, so it cannot learn that a blocked item is there.',
          'The server is a relay. It holds the question, the approved text until it is collected, and a receipt without content.',
        ],
      },
    ],
  },
  {
    id: 'principles',
    title: 'Design principles',
    blocks: [
      {
        p: 'Most connectors give an assistant a search tool and a read tool. To answer "What did my landlord say about the deposit?", the assistant reads whole emails, often several, and all of that text enters a model the person does not control. Instructions hidden inside those emails enter with it.',
      },
      {
        p: 'Sieve reverses the direction. The question travels to the data, the reading happens on the device, and what returns is the smallest text that answers. Six principles follow from that.',
      },
      { h3: 'Data stays where it is' },
      {
        p: "Mail, files, photos, and everything derived from them stay in the browser's storage on the person's computer. Sieve reads Gmail directly from the browser with read-only access. No copy passes through a Sieve server.",
      },
      { h3: 'Share the least that answers' },
      {
        p: 'The default share is one sentence. Sharing the lines that hold the answer, or the whole item, are separate steps that an assistant must be granted and the person must approve.',
      },
      { h3: 'The person decides' },
      { p: 'Every share waits for the person. The approval screen shows the exact characters that would leave, not a description of them.' },
      { h3: 'Plain code sets the limits, and models work inside them' },
      {
        p: 'Rules, filters, size limits and masks are ordinary code. A model never decides whether a rule applies. Models do the parts that need language: finding the right item among lookalikes and writing the answer.',
      },
      { h3: 'When unsure, share nothing' },
      { p: 'Each check after the answer is written can end the request. A request that ends this way returns "Nothing to share for that."' },
      { h3: 'Say where each step ran' },
      {
        p: 'Under every answer, a trace lists each step and where it ran: plain code, the on-device model, or the cloud. For model calls the trace shows the source the Firebase SDK reported, never an assumed value.',
      },
    ],
  },
  {
    id: 'architecture',
    title: 'Architecture',
    blocks: [
      {
        p: "Sieve has two halves. The half that touches private data runs in Chrome on the person's computer. The half in the cloud passes messages and keeps records, and never holds private data.",
      },
      { figure: 'architecture' },
      {
        table: {
          caption: 'Table 1 · The parts of Sieve',
          head: ['Part', 'Where it runs', 'What it does'],
          rows: [
            ['Home base (the Sieve tab)', "Chrome, on the person's computer", 'Holds the index, runs the search and the on-device model, shows the approval'],
            ['Chrome extension', 'The same computer', 'A badge and a side panel, so a request can be approved without switching tabs'],
            ['MCP endpoint', 'Cloud Functions for Firebase', "Receives tool calls from assistants, checks the connection's grant, queues the request"],
            ['Request queue', 'Cloud Firestore', 'Requests, receipts, settings and grants'],
            ['Presence', 'Firebase Realtime Database', 'Whether the home base is online'],
            ['Notifications', 'Firebase Cloud Messaging', '"A request is waiting", with no content'],
            ['Models', 'Firebase AI Logic', 'One API for Gemini Nano on the device and Gemini in the cloud'],
          ],
        },
      },
      { h3: 'Trust boundaries' },
      {
        ul: [
          '**Never leaves the device:** mail and file contents, the index, subjects and previews, photo captions, personal details found in them, and answers that were not approved.',
          '**Reaches Firebase:** who asked, the question, the status of the request, the approved text until it is collected, receipts without content, settings and grants.',
          "**Reaches Gemini in the cloud:** text the person approved, when they ask Sieve to draft a reply from it. A person's own data goes to the cloud for any other step only if they turn on cloud fallback and allow that single request.",
        ],
      },
    ],
  },
  {
    id: 'index',
    title: 'The private index',
    blocks: [
      {
        p: "Before Sieve can answer, it reads the person's sources and builds an index in the browser's storage. The work runs in a background queue that pauses whenever a question arrives.",
      },
      { h3: 'Sources' },
      {
        ul: [
          '**Gmail**, with read-only access. The browser calls Gmail directly, and the access token is kept in the browser.',
          "**Folders** the person picks, read through Chrome's File System Access API.",
          '**Photos and files** the person adds.',
        ],
      },
      { h3: 'What happens to each item' },
      {
        ol: [
          '**Hidden text is removed.** Plain code strips text a reader would not see: white on white, tiny or clipped text, and text placed off screen. What was removed stays viewable.',
          '**The item gets one category:** Home, Work, Money, Health, Travel, Shopping, Personal, Newsletters or Photos. Rules assign it first, and Gemini Nano refines it on the device.',
          '**The text is made searchable.** It is split into passages of about 160 words. Each passage becomes a list of 384 numbers that stands for its meaning, computed by a small embedding model in a Web Worker. A keyword index is built beside it.',
          '**Photos get a caption** written by Gemini Nano, which is searched like text.',
          '**The item is checked once** for instructions aimed at an AI and for personal details.',
        ],
      },
      { h3: 'How much mail is indexed' },
      {
        p: 'Sieve indexes the last six months of mail. The newest 2,000 emails are stored with their full text. Older ones are stored by subject, sender and first lines, and their body is fetched when a question needs it. Sieve checks for new mail every five minutes.',
      },
      {
        note: '**Note:** Gmail access lasts one hour and is held only in the browser. Sieve renews it the next time the person clicks in the app. Until then, questions are answered from the mail already indexed.',
      },
    ],
  },
  {
    id: 'question',
    title: 'The path of one question',
    blocks: [
      { p: 'A question passes through ten steps. Plain code and the on-device model take turns, and the person has the last word.' },
      { figure: 'steps' },
      {
        table: {
          caption: 'Table 2 · What each step does',
          head: ['', 'Step', 'Done by', 'What happens'],
          rows: [
            ['1', 'Read the question', PLAIN_CODE, 'Finds dates, a sender and exact numbers in the question. Questions Sieve cannot answer in one fact, such as counts and lists, stop here.'],
            [
              '2',
              'Think of other words',
              ON_DEVICE,
              'Names four to six phrases the answering item may use, because an email often says "bike cage" where the question says "bicycle storage". Skipped when the question holds an exact number or the assistant gave dates.',
            ],
            ['3', 'Search', PLAIN_CODE, 'Searches the index by meaning and by keyword and merges the two lists. A second small model on the device reorders the best 20.'],
            [
              '4',
              'Apply rules, put in order',
              PLAIN_CODE,
              'Removes items in a **Never share** category and items that hold a one-time code. An exact number keeps only the items that hold it. "The latest" keeps the newest. The best five go on.',
            ],
            ['5', 'Read and answer', ON_DEVICE, 'Gemini Nano reads one passage from each of the five items, picks the one that answers, and writes one sentence.'],
            [
              '6',
              'Check shape and freshness',
              PLAIN_CODE,
              'Confirms the item still exists at its source. Rejects an answer that packs several facts, that copies more than 12 words in a row, or that lacks the date or amount the question asked for.',
            ],
            ['7', 'Second check', ON_DEVICE, 'A separate call reads the chosen item again and says whether it really answers the question.'],
            ['8', 'Mask personal details', PLAIN_CODE, 'Replaces names, addresses, numbers and similar details with marks such as `[name]`.'],
            ['9', 'Last look', ON_DEVICE, 'Gemini Nano reads the text that would leave. Anything it finds is masked by plain code.'],
            ['10', 'Approve', { chip: 'The person', tone: 'person' }, 'Sees the exact outgoing text with any warnings. Approves it, shares a lower step, or declines.'],
          ],
        },
      },
      { h3: 'Measured behavior' },
      { p: 'These figures come from one machine and one test set, and other setups will differ.' },
      {
        ul: [
          '**Search quality.** On a synthetic set of 70 questions over 46 sample items mixed with 1,974 unrelated emails, the item that answers is among the five that are read for 93% of questions, and for 96% when the reordering model runs.',
          '**Speed.** On an Apple M2 with 16 GB of memory, the search takes well under a second and each on-device model call takes one to four seconds once the model is loaded. Setting up the on-device model for the first time takes three to four minutes.',
        ],
      },
    ],
  },
  {
    id: 'ladder',
    title: 'The need-to-know ladder',
    blocks: [
      { p: 'Every share is one of three steps. Each step is a separate tool, so the grant given to an assistant caps how far it can ask.' },
      { figure: 'ladder' },
      {
        table: {
          caption: 'Table 3 · The three steps',
          head: ['Step', 'What leaves', 'MCP tool'],
          rows: [
            ['Answer', 'One sentence written on the device from one item. Its facts must be found in that item, or Sieve warns the person.', '`sieve_answer`'],
            ['Excerpt', 'The lines of the item that hold the answer, with personal details masked', '`sieve_excerpt`'],
            ['Full item', 'The whole item, up to 8,000 characters, with personal details masked', '`sieve_full_item`'],
          ],
        },
      },
      { p: 'At approval the person can lower the step. They cannot raise it above what the assistant was granted.' },
    ],
  },
  {
    id: 'rules',
    title: 'Category rules',
    blocks: [
      { p: 'Each of the nine categories has one rule, which the person can change.' },
      {
        table: {
          caption: 'Table 4 · Rules a category can have',
          head: ['Rule', 'Effect', 'Default for'],
          rows: [
            ['Share with approval', 'The item can be used. Its answer waits for approval.', 'Most categories'],
            ['Ask first', 'As above, with a warning on the approval screen', 'Money'],
            ['Never share', 'The item is removed before any model reads its content', 'Health'],
          ],
        },
      },
      {
        p: 'An assistant receives the same sentence, "Nothing to share for that.", after the same minimum delay, whether an item was blocked, was never shared or was not found. It cannot tell from the reply or its timing that a Health item exists. The person still sees the real reason in the app.',
      },
    ],
  },
  {
    id: 'hidden-instructions',
    title: 'Hidden instructions',
    blocks: [
      { p: 'An email can carry text written for an AI, such as an instruction to forward the inbox. Sieve handles this in three layers.' },
      {
        ol: [
          '**Plain code first.** Text a reader would not see is removed when the item is indexed, before any model reads it.',
          '**The on-device model flags what is left.** Gemini Nano checks the remaining text for instructions aimed at an AI and shows a warning. This check is advisory.',
          "**The structure is the boundary.** Sieve has no tool that sends, replies or deletes, so nothing in an item can trigger an action. The answer is written on the device and cannot copy long runs of the item's wording. The person reads the outgoing text before it leaves.",
        ],
      },
    ],
  },
  {
    id: 'personal-details',
    title: 'Personal details',
    blocks: [
      { p: 'Personal details are found on the device only. No cloud detector is used. Three detectors run in turn:' },
      {
        ul: [
          '**Validators in plain code** for details with a fixed shape: card numbers, IBANs, phone numbers, email addresses and others.',
          '**A small detection model** that runs in the browser and finds names, addresses and similar details.',
          '**A last pass by Gemini Nano** over the exact text that would leave.',
        ],
      },
      {
        p: 'What they find is replaced by a mark such as `[name]` or `[address]`. Organization names stay, because an answer usually needs them. An answer that would consist only of marks is not sent.',
      },
    ],
  },
  {
    id: 'relay',
    title: 'The relay',
    blocks: [
      {
        p: "An assistant that supports Model Context Protocol connectors can ask Sieve from anywhere. The relay carries the question to the person's computer and the approved text back.",
      },
      { figure: 'relay' },
      { h3: 'Connections and grants' },
      {
        p: 'Each assistant connects with its own grant. The grant names the steps it may ask for, the sources it may ask about and the categories it may reach. Every use of a grant is added to an audit chain that stores hashes only.',
      },
      { h3: 'What the assistant can send' },
      {
        p: 'A question in plain words, and optional hints: the dates the person meant, who the item is from, exact identifiers such as an order number, and whether it is in mail, files or photos. Sieve treats the question as a search request and ignores instructions inside it.',
      },
      { h3: 'Waiting and limits' },
      {
        ul: [
          'A connection can have three requests waiting and can make 80 calls in ten minutes.',
          'A request can be approved for up to two hours after it was made, and its record is removed after a day.',
          'If the home base is closed, the assistant is told that Sieve is offline. If the tab is in the background, the person gets a notification that says a request is waiting and nothing else.',
          'The approved text is deleted from the relay as soon as the assistant collects it.',
        ],
      },
      {
        note: '**Note:** For testing, a person can let one connection through without approval for two hours. The rules, checks and masks still apply, and the setting turns itself off.',
      },
    ],
  },
  {
    id: 'receipts',
    title: 'Receipts and the trace',
    blocks: [
      { p: 'Sieve keeps two records, both without content.' },
      {
        ul: [
          '**A receipt for every share:** who asked, what they asked, which step, which item, when, and who approved. The page "What has AI seen?" lists them.',
          '**A trace under every answer:** two lanes, "On this device" and "In the cloud", with each step, where it ran, and the number of characters that crossed between the lanes.',
        ],
      },
    ],
  },
  {
    id: 'models',
    title: 'Where each model call runs',
    blocks: [
      {
        p: 'All model calls go through Firebase AI Logic, which offers Gemini Nano on the device and Gemini in the cloud through one API. Sieve sets the mode for each call and fails an on-device-only call if the SDK ever reports that it ran in the cloud.',
      },
      {
        table: {
          caption: 'Table 5 · Inference mode by step',
          head: ['Step', "A person's own data", 'Sample data'],
          rows: [
            ['Pick the item and write the answer', DEVICE_ONLY, 'On device when Gemini Nano is ready. Otherwise in the cloud, labelled.'],
            ['Other search words', DEVICE_ONLY, DEVICE_ONLY],
            ['The second check', DEVICE_ONLY, 'As for the answer'],
            ['Categories, photo captions, the check for hidden instructions', DEVICE_ONLY, 'As for the answer'],
            ['The personal details pass', DEVICE_ONLY, DEVICE_ONLY],
            ['Draft a reply', { chip: 'Cloud', tone: 'cloud', after: ' from approved text only' }, 'The same'],
          ],
        },
      },
      { p: 'Every call is a single prompt that Sieve assembles. Sieve keeps no chat session on private data.' },
    ],
  },
  {
    id: 'limits',
    title: 'Limits',
    blocks: [
      {
        ul: [
          "**Chrome on a desktop.** A person's own data is processed only where Gemini Nano is available: Chrome 139 or later on a desktop computer. Without it, Sieve can still be tried on a real computer that has the model set up.",
          '**The tab must be open.** The home base does the private work, so an assistant can reach Sieve only while that tab is open.',
          '**One fact from one item.** Sieve does not count items, list them or combine several into one answer.',
          '**A small model.** The on-device model can pick an item that only looks right. The checks after it stop many of these and not all of them, which is one reason the person reads the text before it leaves. Sieve also returns nothing for some questions it could have answered.',
          '**Freshness.** New mail is read only while Gmail access is valid. After an hour without a click in the app, answers come from the mail already indexed.',
          '**Language.** Sieve is built and tested in English.',
        ],
      },
    ],
  },
  {
    id: 'next',
    title: "What's next",
    blocks: [
      {
        ul: [
          'Try on a real computer: a seat on a Mac with Gemini Nano already set up, streamed to your browser, with sample data. Ask a question and watch the trace.',
          'Read the source: the web app, the relay, the extension and the test bench, under Apache 2.0.',
        ],
      },
      { next: true },
    ],
  },
];
