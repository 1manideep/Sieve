// The Playground's outside assistant (00 D1; 30 section 16; 40 section 13.9). Runs without the emulators: Playwright
// answers the anonymous sign-in, the issuePlaygroundGrant callable, the connector at /mcp/<secret> and cloud Gemini
// (Firebase AI Logic's generateContent). The page's real loop, connector client and panel run around them. The
// approval itself goes through Firestore and the Playground relay, so it is covered by the emulator and deployed checks,
// not here: the connector stub answers sieve_check as the server does once the person has approved.
import { expect, test, type Page, type Route } from '@playwright/test';
import { DEPOSIT_ANSWER } from './fixtures/fakeModel';
import { LANDLORD, LANDLORD_OTHER_SENTENCE, openPlayground } from './fixtures/helpers';
import { prepareStubs } from './fixtures/stubs';

const UID = 'e2eAnonymousVisitor01';
const SECRET = 'e2e_playground_link_secret_0123456789abcdef'; // 43 characters, as the server makes them
const REQ = 'E2eRequest0123456789';
const INSTRUCTIONS =
  'Sieve answers questions about one person\'s own email, files and photos. A small model on the person\'s computer finds the item and the person approves every share, so an answer usually takes a minute or more.';
const DEMO_LINE = "This is a demo in the Sieve Playground: the person's email, files and photos are sample data on a pretend computer in their browser.";
const FINAL = 'Your landlord confirmed your $1,200 deposit arrived on March 3. Draft: Thanks for confirming the deposit!';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const TOOLS = [
  { name: 'sieve_answer', description: 'Ask about the person\'s own email, files or photos and get a one-sentence answer written on their computer.' },
  { name: 'sieve_excerpt', description: 'Same as sieve_answer, but shares the lines from the item that hold the answer.' },
  { name: 'sieve_full_item', description: 'Same as sieve_answer, but shares the whole item.' },
  { name: 'sieve_check', description: 'Get the result of an earlier Sieve request whose status was "pending".' },
];

interface McpCall {
  method: string;
  name?: string;
  args?: Record<string, unknown>;
  headers: Record<string, string>;
}

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An unsigned emulator-style ID token (the Auth emulator's tokens are unsigned too). */
function idToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    iss: 'https://securetoken.google.com/e2e', aud: 'e2e', auth_time: now, user_id: UID, sub: UID, iat: now, exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: 'anonymous' },
  })}.`;
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
}

/** Sign-in, the grant callable and the Firestore listener of the Playground relay, all without emulators. */
async function stubFirebase(page: Page): Promise<{ grants: number; firestore: number }> {
  const counts = { grants: 0, firestore: 0 };
  await page.route(/http:\/\/127\.0\.0\.1:9099\/.*/, async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.includes('accounts:signUp')) {
      return json(route, { kind: 'identitytoolkit#SignupNewUserResponse', idToken: idToken(), refreshToken: 'e2e-refresh', expiresIn: '3600', localId: UID });
    }
    if (url.includes('accounts:lookup')) {
      return json(route, { kind: 'identitytoolkit#GetAccountInfoResponse', users: [{ localId: UID, lastLoginAt: String(Date.now()), createdAt: String(Date.now()) }] });
    }
    if (url.includes('/token')) {
      return json(route, { access_token: idToken(), expires_in: '3600', token_type: 'Bearer', refresh_token: 'e2e-refresh', id_token: idToken(), user_id: UID });
    }
    return json(route, {});
  });
  await page.route(/http:\/\/127\.0\.0\.1:5001\/.*issuePlaygroundGrant.*/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    counts.grants += 1;
    return json(route, {
      result: {
        grantId: 'e2eGrant000000000001', link: `https://sieve.manideep.info/mcp/${SECRET}`, linkHint: SECRET.slice(-4),
        maxStep: 'full', allowedCategories: [], allowedSources: ['playground'], expiresAt: Date.now() + 86_400_000,
      },
    });
  });
  // The relay's Firestore listener has no emulator here; it keeps retrying in the background.
  await page.route(/http:\/\/127\.0\.0\.1:(8080|9000)\/.*/, (route) => {
    counts.firestore += 1;
    return route.abort();
  });
  return counts;
}

/** The connector at /mcp/<secret> on the page's origin, as 30 section 8 answers in the legacy era. */
async function stubConnector(page: Page, decisionDelayMs: number): Promise<McpCall[]> {
  const calls: McpCall[] = [];
  await page.route(/\/mcp\/.*/, async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    calls.push({ method: body.method, name: body.params?.name, args: body.params?.arguments, headers: req.headers() });
    const reply = (result: unknown) => json(route, { jsonrpc: '2.0', id: body.id, result });
    const tool = (r: Record<string, unknown>) =>
      reply({ content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r, isError: false });
    if (body.method === 'initialize') {
      return reply({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sieve', title: 'Sieve', version: '1.0.0' }, instructions: INSTRUCTIONS });
    }
    if (body.method.startsWith('notifications/')) return route.fulfill({ status: 202, headers: CORS, body: '' });
    if (body.method === 'tools/list') return reply({ tools: TOOLS.map((t) => ({ ...t, inputSchema: { type: 'object' } })) });
    if (body.params?.name === 'sieve_answer') {
      await new Promise((r) => setTimeout(r, 300));
      return tool({ status: 'pending', request_id: REQ, message: `The person has not approved this yet. Tell them a request is waiting in Sieve, then call sieve_check with request_id "${REQ}"; it waits up to 45 seconds for their decision.` });
    }
    // sieve_check: the server holds it until the person decides, then collects the approved text once.
    await new Promise((r) => setTimeout(r, decisionDelayMs));
    return tool({ status: 'answered', request_id: REQ, step: 'answer', text: DEPOSIT_ANSWER, message: 'The person approved sharing this answer.' });
  });
  return calls;
}

/** Cloud Gemini: the first turn calls sieve_answer, the second answers in text. Records each request body. */
async function stubGemini(page: Page): Promise<Record<string, unknown>[]> {
  const requests: Record<string, unknown>[] = [];
  await page.route(/https:\/\/firebasevertexai\.googleapis\.com\/.*/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const parts =
      requests.length === 1
        ? [{ functionCall: { name: 'sieve_answer', args: { question: 'What did my landlord say about the deposit?', from: 'landlord' } } }]
        : [{ text: FINAL }];
    return json(route, { candidates: [{ index: 0, content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } });
  });
  return requests;
}

test.describe('Playground outside assistant', () => {
  test('cloud Gemini asks through the connector, waits for approval, and gets exactly the approved 41 characters', async ({ page }) => {
    const { forbidden, errors } = await prepareStubs(page, { availability: 'available' });
    const firebase = await stubFirebase(page);
    const mcp = await stubConnector(page, 2500);
    const gemini = await stubGemini(page);
    await openPlayground(page, errors);

    const section = page.getByTestId('playground-assistant');
    await expect(section.getByRole('heading', { name: 'Gemini in the cloud asks; Gemini Nano on your device decides what it gets.' })).toBeVisible();
    await section.getByRole('button', { name: 'Try the cloud assistant' }).click();
    await expect(section.getByText('This is the real thing, on sample data')).toBeVisible();
    // Opening the panel connects nothing.
    expect(firebase.grants).toBe(0);
    expect(mcp).toHaveLength(0);

    await section.getByRole('button', { name: LANDLORD, exact: true }).click();
    await expect(section.getByTestId('call-wait').getByText('Waiting for your approval')).toBeVisible({ timeout: 20_000 });
    await expect(section.getByTestId('assistant-answer')).toContainText(FINAL, { timeout: 20_000 });
    await expect(section.getByText('Connected: Gemini has a one-day link to this Playground.')).toBeVisible();
    await expect(section.getByTestId('received-chars')).toHaveText('Gemini received 41 characters of your data');
    await expect(section.getByTestId('received-text')).toHaveText(DEPOSIT_ANSWER);
    const trace = section.getByRole('region', { name: 'Where each step ran' });
    await expect(trace.getByTestId('lane-arrow')).toContainText('41 characters crossed to the cloud');

    // One grant; the connector in the legacy era with the 2025-06-18 header; the page's sieve_check for the pending result.
    expect(firebase.grants).toBe(1);
    expect(mcp.map((c) => c.name ?? c.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'sieve_answer', 'sieve_check']);
    for (const c of mcp) {
      expect(c.headers['content-type']).toBe('application/json');
      expect(c.headers['mcp-protocol-version']).toBe('2025-06-18');
    }
    expect(mcp[4].args).toEqual({ request_id: REQ });

    // Gemini: the server's instructions plus the demo line, the four tools, then the approved text as the function response.
    expect(gemini).toHaveLength(2);
    expect(JSON.stringify(gemini[0].systemInstruction)).toContain(JSON.stringify(`${INSTRUCTIONS}\n\n${DEMO_LINE}`).slice(1, -1));
    const decls = (gemini[0].tools as { functionDeclarations: { name: string }[] }[])[0].functionDeclarations;
    expect(decls.map((d) => d.name)).toEqual(TOOLS.map((t) => t.name));
    const second = JSON.stringify(gemini[1].contents);
    expect(second).toContain('"functionResponse"');
    expect(second).toContain(DEPOSIT_ANSWER);
    for (const body of gemini) expect(JSON.stringify(body)).not.toContain(LANDLORD_OTHER_SENTENCE);
    expect(forbidden).toEqual([]);
  });

  test('the daily cap stops the assistant before any cloud call, with the exact message', async ({ page }) => {
    const { errors } = await prepareStubs(page, { availability: 'available' });
    await stubFirebase(page);
    const mcp = await stubConnector(page, 100);
    const gemini = await stubGemini(page);
    await page.addInitScript(({ uid }) => {
      const d = new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      localStorage.setItem(`sieve.playgroundAssistant.cloudCalls.${uid}`, JSON.stringify({ day, n: 30 }));
    }, { uid: UID });
    await openPlayground(page, errors);
    const section = page.getByTestId('playground-assistant');
    await section.getByRole('button', { name: 'Try the cloud assistant' }).click();
    await section.getByRole('button', { name: LANDLORD, exact: true }).click();
    const message = "This browser has used today's 30 cloud calls for the Playground assistant. Try again tomorrow; everything else in the Playground still works.";
    await expect(section.locator('li').getByText(message)).toBeVisible({ timeout: 20_000 });
    expect(gemini).toHaveLength(0);
    expect(mcp.filter((c) => c.method === 'tools/call')).toHaveLength(0);
  });
});
