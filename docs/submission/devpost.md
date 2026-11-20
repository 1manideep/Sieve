# Sieve: Devpost submission text

What to paste into the Devpost form for #BuildHybridAI 2026. Sources: `docs/spec/60-testing-bench-submission.md` sections 2.1 and 8, and `README.md`. Rules that bind this text: English only; no third-party advertising, slogan, logo or trademark; no production keys, project secrets, connector links, tokens or personal data; no number about data exposure until the bench has produced it (60 section 4.12).

## Form fields

| Field | Value |
|---|---|
| Project name | Sieve |
| Tagline | Give AI the answer, not your inbox. |
| Platform | Web (Chrome) |
| Built with | Firebase AI Logic, Gemini Nano, Gemini API, Firebase App Check, reCAPTCHA Enterprise, Firebase Authentication, Cloud Firestore, Firebase Realtime Database, Cloud Functions for Firebase (Python), Firebase Cloud Messaging, Firebase Hosting, Firebase Emulator Suite, Chrome Extensions (Side Panel API), Model Context Protocol, TypeScript, React, Vite, Python, MiniSearch, Transformers.js, Ratchet |
| Try it out links | https://sieve.manideep.info/playground, https://sieve.manideep.info, https://github.com/1manideep/Sieve, the extension zip on the GitHub release page, and the Chrome Web Store listing only if it is live |
| Video | The YouTube URL (pending) |
| Repository | https://github.com/1manideep/Sieve (public, Apache-2.0) |
| Testing instructions | The block under "Testing instructions" below |
| Images | 3 to 5 screenshots of the Playground and the side panel, sample data only, no third-party logos or sites in the frame |

Remote Config is not used, so it is not listed.

## About the project

Paste everything between the two rules into the project story field.

---

## Inspiration

To find one email, an assistant connected to an inbox searches and reads widely. Every extra email is private data in someone else's cloud, and any email a stranger wrote can carry instructions: private data, untrusted content and a way to act, the mix security researchers call the lethal trifecta. Picture one everyday person with a lease, a bank and a doctor in their inbox: what an assistant needs is usually one sentence.

## What it does

Sieve sits between a person's data (Gmail, a local folder of files and photos) and AI assistants. Gemini Nano in Chrome, through Firebase AI Logic, finds what a request needs, and Sieve shares the least it can, only with the person's approval.

- **Ask inside the app.** Nano finds the item and writes the answer on the device; Gemini in the cloud drafts a reply from only the approved text.
- **Ask from an outside assistant.** Any assistant that supports MCP connectors calls Sieve's connector. The person's open Sieve tab does the private work; they approve in the Chrome extension's side panel, without leaving the assistant's tab.
- **The Playground.** A pretend computer with sample data and no login, where visitors can add files and write emails that try to trick the AI. Its assistant shows the hybrid: Gemini in the cloud asks; Gemini Nano on your device decides what it gets.

Every share is a step on the need-to-know ladder, shown as the exact outgoing text: the answer (one sentence written on the device, the default), an excerpt (the lines that hold it) or the full item, redacted. Category rules apply before any model reads an item: Health never, Money asks first. Injected instructions are kept away from the assistant by design and flagged when spotted. "What has AI seen?" keeps a receipt of every share, never the content, and a two-lane trace shows where each step ran, as the SDK reported it.

The value: people can use AI assistants with their real mail and files without handing over their inbox, and approve every word that leaves.

## How we used Firebase AI Logic

Every model call is a Firebase AI Logic `GenerativeModel` call, and a policy picks the inference mode from whose data it is:

- **Own data:** `ONLY_ON_DEVICE` on Gemini Nano for every step that reads it: the answer, labels, photo captions, the injection advisory and the personal details pass.
- **Drafts:** `PREFER_IN_CLOUD` on Gemini, from approved text only.
- **Sample data:** `PREFER_ON_DEVICE`, or the cloud, labelled, when the browser has no Nano.
- **The Playground assistant:** Gemini in the cloud with function calling plays the outside assistant.

Every call is one prompt Sieve assembles, never a chat session on private data, and the trace shows the inference source the SDK reports. On-device calls use our own Chrome adapter, passed to the public `GenerativeModel` constructor: the built-in one opens a session per call and cannot abort, and with no adapter the SDK would use the cloud even in `ONLY_ON_DEVICE`. Ours keeps warm sessions, pauses background work for questions, and streams. The calls live in `web/src/ai/hybrid.ts`, `web/src/ai/init.ts` and `web/src/ai/device/adapter.ts`.

## How we built it

App Check with reCAPTCHA Enterprise protects AI Logic. Authentication signs people in, anonymously in the Playground. Firestore holds the relay queue, receipts and grants; the Realtime Database tracks whether the Sieve tab is online; Cloud Messaging says "A request is waiting" without content. A Python Cloud Function is the MCP server, with Ratchet for scoped, expiring grants and a tamper-evident audit log. Hosting routes `/mcp/**` to it; the Emulator Suite runs every test. The extension talks to the Sieve tab only through local messaging, so previews never touch a server.

## Challenges we ran into

- Nano's 9,216-token limit per call: Sieve shortlists first and sends the best passage of each candidate.
- The model download: one explicit click, a real progress bar, and on-device calls only once the model is ready.
- Hybrid routing can quietly pick the cloud: own data always gets `ONLY_ON_DEVICE` with our adapter, and a call the SDK reports as cloud is stopped.
- No Firebase product finds personal details, so Sieve layers validators, a browser model and Nano, all on the device.
- Approving without leaving the assistant's tab, which led to the side panel.

## Accomplishments that we're proud of

The golden path in one window, from question to approved draft. A trace that never assumes. A Playground judges can add their own files to. A real Mac with Nano streamed into the site for judges without Nano.

## What we learned

Small on-device models need plain-code guards around them. The structure of sharing is the real defence; the model is the warning light. Per-item model work runs once in the background, so a question costs one on-device call.

## What's next for Sieve

Phone approval with end-to-end encryption, OAuth for connectors, the extension as the home base, and more sources.

## Built during the hackathon, and pre-existing work

Sieve was started for #BuildHybridAI 2026. The repository's first commit is Nov 15, 2026, inside the submission period (Nov 11 to Nov 30, 2026), so all of it was built after the period opened on Nov 11.

Pre-existing work: Ratchet (`ratchet-authz-core` on PyPI), an open-source authorization library (MIT) by the same author, developed before Sieve and used unmodified for the connector grants and audit log; Sieve's grant model, MCP tools and Firestore audit store are new. Also open-source libraries, two browser models, a word list and free-to-use photos, each under its own license.

---

The measured number is left out on purpose: the bench has not run yet. When it has, add a heading "The measured number" before "Challenges we ran into", with only the lines printed by the bench's `lines` command for the final run set and one sentence of method.

## Testing instructions

Paste this into the testing instructions field.

```
No login needed. Open https://sieve.manideep.info/playground in Chrome on a desktop and pick a suggested question.

On Chrome 139+ with Gemini Nano available, the Playground runs on your device. Without it, the sample data runs in the cloud and is labelled; files you add wait for your OK before the cloud reads them.

No Gemini Nano on your machine? Click Try it on a real computer to use Sieve on a Mac with Nano ready (one of two seats, about 15 minutes).

Optional, the side panel: download the extension zip from the GitHub release (link above), unzip it, open chrome://extensions, turn on Developer mode, choose Load unpacked and pick the folder. Then press "Send a test request to the extension" in the Playground and click the Sieve icon in the toolbar.

Optional, the relay with your own MCP client: see "Connect an outside assistant" in the README. It needs a signed-in account.

All data in the Playground is made up.
```

Never add a connector link, an App Check debug token or any key to this text.
