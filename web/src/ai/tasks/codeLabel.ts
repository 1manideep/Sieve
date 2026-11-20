// Plain-code categories (10 section 10.2): the fallback when no model can label an item, and the Health safety net.
// Pure, with no model imports, so ingest (20) can import it from here without loading the SDK.
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

// Order matters: the first category with a matching pattern wins.
export const CODE_LABEL_RULES: [Category, RegExp[]][] = [
  ['Health', HEALTH_STRONG],
  ['Money', [/\b(bank|statement|credit card|card services|debit|payment|paid|payroll|w-2|1099|tax(es)?|tax return|invest\w*|portfolio|loan|mortgage|wire transfer|transfer|credit union|refund)\b/i]],
  ['Travel', [/\b(flight|airline|air|boarding|check in now|booking reference|hotel|inn|reservation|rental car|car rental|itinerary|trip|passport|visa)\b/i]],
  ['Home', [/\b(rent|landlord|lease|apartment|unit \d+\w?|property management|maintenance request|electricity|power|water bill|gas bill|utility|utilities|package room|concierge|move-out|move-in|inspection)\b/i]],
  ['Work', [/\b(meeting|agenda|q[1-4] planning|interview|recruit\w*|offer letter|pr #?\d+|code review|pull request|timesheet|hr operations|slides|customer demo|standup|1:1)\b/i]],
  ['Newsletters', [/\b(newsletter|digest|weekly|webinar|podcast|episode|deals?|sale|% off|black friday|promo\w*|product update|what's new|unsubscribe)\b/i]],
  ['Shopping', [/\b(order|shipped|shipping|delivered|return label|receipt|pickup order|tracking)\b/i]],
  ['Personal', [/\b(mom|dad|birthday|wedding|invitation|party|saturday|sunday|photos from|pictures)\b/i]],
];

const PHOTO_DOCUMENT = /\b(receipt|bill|statement|invoice|prescription|ticket|boarding pass|letter|lease|form|document|screenshot of)\b/i;
const PHOTO_DOCUMENT_CATEGORIES = new Set<Category>(['Health', 'Money', 'Home', 'Travel', 'Shopping', 'Work']);

type LabelInput = Pick<IndexRecord, 'title' | 'from' | 'preview' | 'kind'>;

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
  for (const [category, rules] of CODE_LABEL_RULES) {
    if (rules.some((r) => r.test(text))) return { category, matched: true };
  }
  return { category: 'Personal', matched: false };
}

export function isHealthStrong(item: Pick<IndexRecord, 'title' | 'from' | 'preview'>): boolean {
  const text = fold(`${item.from ?? ''}\n${item.title}\n${item.preview ?? ''}`);
  return HEALTH_STRONG.some((r) => r.test(text));
}
