// Plain-code categories (10 section 10.2): the first category every item gets at ingest, the fallback when no model
// can label an item, and the Health safety net. Pure, with no model imports, so ingest (20) can import it from here
// without loading the SDK. Since Nov 21, 2026 mail that matches no category's words is filed by who sent it.
import type { Category, IndexRecord } from '@sieve/shared';

export const HEALTH_STRONG: RegExp[] = [
  /\b(doctor|physician|patient|clinic|medical|hospital|pharmacy|prescriptions?)\b|\bdr\.\s/i,
  /\b(test results?|lab results?|lab services|blood (draw|test|work)|biopsy|diagnos\w*|vaccin\w*|immuni[sz]ation)\b/i,
  /\b(dental|dentist|orthodont\w*|therap(y|ist)|counsel(l)?ing|behavioral health|mental health|psychiatr\w*)\b/i,
  /\b(health plan|health insurance|explanation of benefits|care team|patient portal)\b/i,
  // 70 R-MAIL-08: German, French, Spanish, Italian, Portuguese and Japanese, matched on accent-folded text
  /\b(befund|laborbefund|arztbrief|krankenkasse|rezept ist abholbereit|ordonnance|resultats d'analyse|compte rendu medical|mutuelle sante|resultados de laboratorio|receta medica|cita medica|historia clinica|referto|ricetta medica|analisi del sangue|resultado de exame|receita medica|consulta medica)\b/i,
  /(検査結果|処方箋|診察|診断書)/,
];

/** Accent folding for the phrase lists (a false positive only makes an item never shared: fail closed). */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

/**
 * A pet's insurance or vet. Health is the person's own health; mail about a pet was filed under Health by the model
 * ("If an item could be Health, choose Health") and so was never shared (Nov 21, 2026: a question about
 * it found nothing). Such mail is Personal, and it is the one thing moved out of Health.
 */
const PET_CARE = /\b(pet (health |medical )?insurance|pet (wellness|care|health) plans?|veterinar\w+|vet (clinic|hospital|visit|appointment|bill)|animal (hospital|clinic)|trupanion|healthy paws|banfield|embrace pet|pets best|figo pet|lemonade pet)\b/i;

export function isPetCare(item: Pick<IndexRecord, 'title' | 'from' | 'preview'>): boolean {
  return PET_CARE.test(fold(`${item.from ?? ''}\n${item.title}\n${item.preview ?? ''}`));
}

/**
 * A hair salon, a barber or a nail salon, and the booking systems they send from. The label prompt files
 * "appointments" under Health, so a haircut's booking, forms and receipts were never shared (Nov 23, 2026: a
 * salon's receipt could not answer what was paid there). Such mail is Personal, unless it also holds a strong
 * health word (a clinic, a doctor, a prescription), which keeps it in Health.
 */
const SELF_CARE = /\b(hair (salon|loft|studio|bar|lounge|cut|cuts|color|colour)|haircuts?|salon|barbers?|barbershop|blow ?outs?|curly cut|nail (salon|bar|studio)|manicures?|pedicures?|lash (studio|bar|extensions?)|brow (bar|studio|wax\w*)|meevo|meevomail|vagaro|booksy|styleseat|fresha|glossgenius)\b/i;

export function isSelfCare(item: Pick<IndexRecord, 'title' | 'from' | 'preview'>): boolean {
  const text = fold(`${item.from ?? ''}\n${item.title}\n${item.preview ?? ''}`);
  return SELF_CARE.test(text) && !HEALTH_STRONG.some((r) => r.test(text));
}

/** Mail that reads like Health but is not the person's own health: a pet's care, or a salon or a barber. */
export function notOwnHealth(item: Pick<IndexRecord, 'title' | 'from' | 'preview'>): boolean {
  return isPetCare(item) || isSelfCare(item);
}

/** Raised whenever the rules below change, so a testing readout can say which rules a page runs. */
export const CODE_LABEL_VERSION = 5;

// Order matters: the first category with a matching pattern wins.
export const CODE_LABEL_RULES: [Category, RegExp[]][] = [
  ['Health', HEALTH_STRONG],
  ['Money', [
    /\b(bank|statement|credit card|card services|debit|payment|paid|payroll|w-2|1099|tax(es)?|tax return|invest\w*|portfolio|loan|mortgage|wire transfer|transfer|credit union|refund)\b/i,
    // Nov 21, 2026 (measured on 300 labelled emails): what a bank, a card or a bill says about an account.
    /\b(invoice|(available |account )?balance|overdrawn|overdraft|declined|transactions?|budget|spend cap|auto[- ]?reload|direct deposit|account snapshot|credit score|billing statement|amount due|past due)\b/i,
    /:\s*\$\d[\d,]*(\.\d\d)?\s*usd\b/i,                       // "Apple Services: $9.99 USD"
    // Nov 21, 2026: an investment order is Money, not a store order (one was filed under Shopping).
    // By what the mail says, not by the company's name: a broker's or a payment app's promotions stay newsletters.
    /\b(sip order|mutual funds?|brokerage|demat|dividends?|contract note|trade confirmation|payment plan|pay in 4|autopay|auto-pay)\b/i,
  ]],
  ['Travel', [
    /\b(flight|airline|air|boarding|check in now|booking reference|hotel|inn|reservation|rental car|car rental|itinerary|trip|passport|visa)\b/i,
    // Nov 21, 2026: a bus or train booking is Travel (one was filed as a newsletter).
    /\b(booking (confirmation|confirmed|number)|boarding pass|departure station|(bus|train|rail|coach|ferry) (ticket|booking|station))\b/i,
  ]],
  ['Home', [/\b(rent|landlord|lease|apartment|unit \d+\w?|property management|maintenance request|electricity|power|water bill|gas bill|utility|utilities|package room|package locker|concierge|move-out|move-in|inspection|residents?|leasing office|your delivery was picked up)\b/i]],
  ['Work', [
    /\b(meeting|agenda|q[1-4] planning|interview|recruit\w*|offer letter|pr #?\d+|code review|pull request|timesheet|hr operations|slides|customer demo|standup|1:1)\b/i,
    /\b(your application|application (was )?(sent|received|submitted)|pr run|ci (failed|passed)|build failed|workflow run|offsite|sprint review|onboarding)\b|interviews?@|^\[[\w.-]+\/[\w.-]+\]/im,
  ]],
  ['Newsletters', [/\b(newsletter|digest|weekly|webinar|podcast|episode|deals?|sale|% off|black friday|promo\w*|product update|what's new|unsubscribe)\b/i]],
  ['Shopping', [
    /\b(order|shipped|shipping|delivered|return label|receipt|pickup order|tracking)\b/i,
    /\b(thank you for (your )?purchas\w+|your purchase|membership (was|has been) \w+|has been upgraded|subscription (confirmed|renewed))\b/i,
  ]],
  ['Personal', [/\b(mom|dad|birthday|wedding|invitation|party|saturday|sunday|photos from|pictures)\b/i]],
];

/** What a promotion says in its subject (Nov 21, 2026). Looked for only in mail that a company's system sent. */
const PROMOTION = /\b(discounts?|savings?|\d+% ?(off|bonus|discount)|cyber monday|ends (soon|today|tonight)|last chance|don'?t (miss|wait)|limited time|exclusive|members? only|bonus|rewards?|earn|points|miles|giveaway|sweepstakes|survey|premiere|is live|just added|new jobs?|is hiring|job alerts?|curated for you|recommended for you|welcome to|introducing)\b/i;

/** A notice about the person's own account (a sign-in, a security alert, a code): theirs, not a newsletter. */
const ACCOUNT_NOTICE = /\b(security alert|sign(ed)?[- ]in|new sign-in|verify your|verification code|one[- ]time (code|passcode)|password|two[- ]step|new device|your \w+ account (was|data)|account data)\b/i;

/** Addresses people write from: a sender here is a person unless its name says otherwise. */
const FREE_MAIL = /@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|zoho|fastmail)\.[a-z.]+$/i;
/** The name before the @ that a system uses, not a person: no-reply, alerts, news, billing, support and the like. */
const SYSTEM_NAME = /(^|[._+-])(no[._-]?reply\w*|do[._-]?not[._-]?reply|notifications?|notify|alerts?|news(letters?)?|mailer|marketing|promo\w*|offers?|deals?|info|hello|hey|team|support|service|system|billing|updates?|members?|guest|connect|contact|tickets?|jobs?|jobalerts?|careers?|digest|e?mail|rewards?|welcome|accounts?|security|orders?|receipts?|sales|community|events?|admin|postmaster|bounces?)\w*([._+-]|$)/i;
/** A sending subdomain (email.brand.com, news.brand.com, notify.brand.com) or a mailing service. */
const SYSTEM_DOMAIN = /@(e|em|email|mail|mailer|news|newsletters?|info|notify|notifications?|marketing|mkt|promo|go|t|tm|click|links?|welcome|experience|choose|services?|alerts?|updates?|reply|bounce|noreply\w*|[a-z]+-e)\.[\w.-]+$|@([\w-]+\.)*[\w-]*(emailrelay|sendgrid|mailchimp|mailgun|amazonses|mandrillapp|sparkpost|mcsv|rsgsv|list-manage|substack|beehiiv|mcmap|iluv)[\w-]*\./i;

/** The address inside "Name <address>", or the field itself when it is only an address. */
function addressOf(from: string | undefined): string {
  const f = (from ?? '').trim().toLowerCase();
  return /<([^>]+)>/.exec(f)?.[1]?.trim() ?? (f.includes('@') && !f.includes(' ') ? f : '');
}

/**
 * Whether a company's system sent the mail, read from the address alone: a system's name before the @, a sending
 * subdomain or mailing service, or a sender named after its own domain (chase@...chase.com). Free-mail addresses
 * with a person's name are people.
 */
export function isSystemSender(from: string | undefined): boolean {
  const address = addressOf(from);
  const at = address.lastIndexOf('@');
  if (at <= 0) return false;
  const local = address.slice(0, at);
  if (SYSTEM_NAME.test(local) || SYSTEM_DOMAIN.test(address)) return true;
  if (FREE_MAIL.test(address)) return false;
  const labels = address.slice(at + 1).split('.');
  const brand = (labels.length >= 2 ? labels[labels.length - 2] : labels[0]) ?? '';
  const name = local.replace(/[^a-z0-9]/g, '');
  return brand.length >= 4 && name.length >= 4 && (name.includes(brand) || brand.includes(name));
}

const PHOTO_DOCUMENT = /\b(receipt|bill|statement|invoice|prescription|ticket|boarding pass|letter|lease|form|document|screenshot of)\b/i;
const PHOTO_DOCUMENT_CATEGORIES = new Set<Category>(['Health', 'Money', 'Home', 'Travel', 'Shopping', 'Work']);

/** Gmail's own tabs: Promotions, Social and Forums are mail a system sent to many. */
const GMAIL_BULK = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']);

/** Whether Gmail filed a message under Promotions, Social or Forums (its label ids come with every message). */
export function isBulkTab(labelIds: string[] | undefined): boolean {
  return labelIds?.some((l) => GMAIL_BULK.has(l)) === true;
}

type LabelInput = Pick<IndexRecord, 'title' | 'from' | 'preview' | 'kind' | 'bulk'>;

/**
 * The category plain code gives an item, and whether anything matched. The words of each category are tried in
 * order. Mail that matched none is filed by who sent it: a company's system (by its address, or because Gmail put
 * it under Promotions, Social or Forums) is Newsletters, unless it is a notice about the person's own account;
 * anything else is Personal with `matched: false`, which means "not sorted yet".
 */
export function codeLabel(item: LabelInput): { category: Category; matched: boolean } {
  if (item.kind === 'photo') {
    const description = item.preview ?? '';
    if (PHOTO_DOCUMENT.test(description)) {
      for (const [category, rules] of CODE_LABEL_RULES) {
        if (PHOTO_DOCUMENT_CATEGORIES.has(category) && rules.some((r) => r.test(description))) return { category, matched: true };
      }
    }
    return { category: 'Photos', matched: true };
  }
  const text = fold(`${item.from ?? ''}\n${item.title}\n${item.preview ?? ''}`);
  if (notOwnHealth(item)) return { category: 'Personal', matched: true };
  const system = item.kind === 'email' && isSystemSender(item.from);
  // Sent to many: a company's system by its address, or the source's own word for it (Gmail's tabs).
  const many = system || (item.kind === 'email' && item.bulk === true);
  for (const [category, rules] of CODE_LABEL_RULES) {
    // A newsletter that mentions a birthday or a Sunday is still a newsletter: the Personal words are for people.
    if (category === 'Personal' && many) continue;
    if (rules.some((r) => r.test(text))) return { category, matched: true };
  }
  if (many && ACCOUNT_NOTICE.test(fold(item.title))) return { category: 'Personal', matched: true };
  if (many) return { category: 'Newsletters', matched: true };
  if (PROMOTION.test(fold(item.title))) return { category: 'Newsletters', matched: true };
  return { category: 'Personal', matched: false };
}

/**
 * The category an indexed item should have under the current rules, when it differs from the one it has; else
 * null. Two kinds of item qualify: one that only plain code has sorted, and one whose model label plain code
 * disagreed with. A model label plain code agreed with, a rule (the Health safety net) and a seed are never
 * touched, and nothing is moved out of Health except mail about a pet or a salon (notOwnHealth).
 */
export function codeRelabel(
  rec: Pick<IndexRecord, 'title' | 'from' | 'preview' | 'kind' | 'bulk' | 'category' | 'categoryBy' | 'enrich'>,
): Category | null {
  if (rec.kind === 'photo') return null;
  if (rec.category === 'Health' && rec.categoryBy !== 'seed' && notOwnHealth(rec)) return 'Personal';
  // A model's label that plain code disagreed with (marked low): plain code's category is the better one, measured.
  const disputed = (rec.categoryBy === 'device' || rec.categoryBy === 'cloud') && rec.enrich?.label?.confidence === 'low';
  if (rec.categoryBy !== 'code' && !disputed) return null;
  const code = codeLabel(rec);
  // Never out of Health, and only for words or a sender that plain code recognised.
  if (disputed && (rec.category === 'Health' || !code.matched)) return null;
  return code.category === rec.category ? null : code.category;
}

export function isHealthStrong(item: Pick<IndexRecord, 'title' | 'from' | 'preview'>): boolean {
  if (isPetCare(item)) return false;   // a vet "clinic" or an animal "hospital" is not the person's health
  const text = fold(`${item.from ?? ''}\n${item.title}\n${item.preview ?? ''}`);
  return HEALTH_STRONG.some((r) => r.test(text));
}
