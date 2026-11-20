// shortenLinks() (11 section 10.2 step 4): link paths carry tracking ids, addresses and sign-in tokens.
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s<>"')\]]*/gi;

function hostOf(url: string): string {
  try {
    const u = new URL(/^https?:/i.test(url) ? url : `http://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    const m = /^(?:https?:\/\/)?([^/?#:\s]+)/i.exec(url);
    return (m?.[1] ?? 'link').toLowerCase().replace(/^www\./, '');
  }
}

export function shortenLinks(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(URL_RE, (m) => {
    const trail = /[.,;:!?]+$/.exec(m)?.[0] ?? '';
    const url = trail ? m.slice(0, -trail.length) : m;
    if (!url) return m;
    count++;
    return `[link: ${hostOf(url)}]${trail}`;
  });
  return { text: out, count };
}
