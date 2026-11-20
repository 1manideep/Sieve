// Chat exports to text (20 section 16.6): `[YYYY-MM-DD HH:mm] {from}: {text}` per message.

interface ChatMessage { type?: unknown; date?: unknown; from?: unknown; author?: unknown; sender?: unknown; text?: unknown }

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function messageText(t: unknown): string {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('');
  return '';
}

function stamp(date: unknown): { label: string; ms?: number } {
  if (typeof date !== 'string' && typeof date !== 'number') return { label: '' };
  const ms = typeof date === 'number' ? (date < 1e12 ? date * 1000 : date) : Date.parse(date);
  if (!Number.isFinite(ms)) return { label: '' };
  const d = new Date(ms);
  return { label: `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}] `, ms };
}

export function chatToText(json: unknown): { title: string; text: string; lastDate?: number } | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as { messages?: unknown; name?: unknown; chat?: unknown; title?: unknown };
  if (!Array.isArray(obj.messages)) return null;
  const msgs = obj.messages as ChatMessage[];
  const isChat = msgs.some((m) => m && typeof m === 'object' && (typeof m.text === 'string' || Array.isArray(m.text)) && (m.from !== undefined || m.author !== undefined || m.sender !== undefined));
  if (!isChat) return null;
  const name = [obj.name, obj.chat, obj.title].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const title = `Chat with ${name ?? 'chat'}`;
  const lines: string[] = [];
  let lastDate: number | undefined;
  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue;
    if (m.type !== undefined && m.type !== 'message') continue;
    const who = [m.from, m.author, m.sender].find((v) => typeof v === 'string') as string | undefined;
    const text = messageText(m.text);
    if (!text) continue;
    const s = stamp(m.date);
    if (s.ms !== undefined) lastDate = s.ms;
    lines.push(`${s.label}${who ?? 'Someone'}: ${text}`);
  }
  return { title, text: [title, ...lines].join('\n'), lastDate };
}
