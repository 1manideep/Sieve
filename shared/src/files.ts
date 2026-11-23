// A file sent as itself (Nov 22, 2026): the name it may carry and what it is called on screen. The relay checks the
// same things again (functions/sieve/filerules.py); a name this file would change is refused there.
import { SHARED_FILE_NAME_MAX_CHARS, SHARED_FILE_TYPES } from './constants';

/**
 * The name as it may be shown and offered for saving: no folders, no control, format or private-use characters, no
 * leading dots, at most SHARED_FILE_NAME_MAX_CHARS with its ending kept. Never empty.
 */
export function safeFileName(name: string): string {
  let text = (typeof name === 'string' ? name : '').normalize('NFC');
  text = text.replace(/\\/g, '/');
  text = text.slice(text.lastIndexOf('/') + 1);
  text = text.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, '');
  text = text.replace(/[<>:"|?*]/g, '_');
  text = text.replace(/\s+/gu, ' ').trim().replace(/^\.+/, '').trim();
  if (!text) return 'file';
  if (text.length > SHARED_FILE_NAME_MAX_CHARS) {
    const dot = text.lastIndexOf('.');
    const ending = dot > 0 ? text.slice(dot + 1) : '';
    if (dot > 0 && ending.length >= 1 && ending.length <= 5) text = `${text.slice(0, SHARED_FILE_NAME_MAX_CHARS - ending.length - 1).trimEnd()}.${ending}`;
    else text = text.slice(0, SHARED_FILE_NAME_MAX_CHARS).trimEnd();
  }
  return text || 'file';
}

/** The media type a name's ending stands for among those that may be sent, or undefined. */
export function sharedFileTypeOf(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [mime, endings] of Object.entries(SHARED_FILE_TYPES)) if (endings.some((e) => lower.endsWith(e))) return mime;
  return undefined;
}

const KIND_WORDS: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF', 'text/plain': 'text', 'text/csv': 'CSV', 'text/markdown': 'Markdown', 'text/calendar': 'calendar',
  'application/msword': 'Word', 'application/vnd.ms-excel': 'Excel', 'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
};

export function sharedFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One line for the card, the assistant and the receipt: "Lease_2026.pdf (PDF, 178 KB)". */
export function describeSharedFile(name: string, mime: string, bytes: number): string {
  const kind = KIND_WORDS[mime] ?? (mime.startsWith('image/') ? 'image' : 'file');
  return `${name} (${kind}, ${sharedFileSize(bytes)})`;
}
