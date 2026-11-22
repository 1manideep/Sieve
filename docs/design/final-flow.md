# The final design: one device, black, Gemini blue

Locked Nov 20. The design canvas "Sieve, the Google direction" holds the boards; the final row (F1 to F8, F6A, F8B) is the spec. Each board is a plain HTML file (`*.dc.html`), one per screen.

## The scheme

| Token | Value | Where |
|---|---|---|
| Ground | `#000000` with a 24 px dot grid: `radial-gradient(rgba(255,255,255,.12) 1px, transparent 1.4px)`, `background-size: 24px 24px` | every screen |
| Surface (glass card) | `rgba(11,11,15,.8)`, border `1px solid rgba(255,255,255,.12)`, radius 24 px on big cards, 18 on small, `backdrop-filter: blur(14px)` on floating ones | cards, the prompt card, the gate |
| Surface, solid | `#0B0B0F` | rails; inner boxes use `#000000` with border `rgba(255,255,255,.08)` |
| Text | `#FFFFFF` primary, `rgba(255,255,255,.75)` secondary, `rgba(255,255,255,.55)` muted, `rgba(255,255,255,.5)` labels | |
| Accent | `#8AB4F8` (Gemini blue): the one approved line, counts, links, badges, "45 never shared" | never as a fill behind text |
| Primary button, app | `#1B6EF3` with white text, pill | Approve, Connect an assistant |
| Primary button, public | `#FFFFFF` with black text, pill | Open Sieve, Ask, Try now, Take seat 1 |
| Secondary button | transparent, `1px solid rgba(255,255,255,.25)` to `.5`, white text, pill | |
| Status | ok `#6DD58C`, waiting `#FDD663`, never `#F28B82`, the red badge in the extension `#B91C1C` | only for state, never decoration |
| The ribbon | `linear-gradient(90deg, transparent 0%, #1B6EF3 28%, #8AB4F8 55%, #1B6EF3 78%, transparent 100%)`, `filter: blur(90px) brightness(0.7)`, `opacity: .75` (a second one `.7`), height 190 px, pill radius, rotated -14 deg / +12 deg, still | the only glow, one or two per screen, low |
| Type | `'Google Sans'` 400 for headlines (56 to 104 px, letter-spacing -0.02 to -0.03em), 500 for UI; `'Google Sans Code'` for counts, labels and receipts. Both from Google Fonts css2. Fallback: system-ui | |
| Shapes | pills (999) for every button and chip; 28 px on the prompt card; 16 px on inner boxes | |
| Motion | stars twinkle (opacity .3 to 1, 4 to 9 s, each on its own clock); nothing else moves until pressed; `prefers-reduced-motion` turns it off | the landing, the home |

The sentence on every screen, somewhere small: **Only what you approve leaves your computer.**

## The screens

| Board | Route | What it is |
|---|---|---|
| F1 Open | `/` (the public landing, for everyone); `/welcome` and `/landing` redirect here | Black, stars, the white dotted sphere (640 px, masked), the constellation (1,204 emails / 92 photos / 31 documents caught on the sphere, one dotted Gemini-blue line out to "one approved line"), two ribbons, "Only what you approve leaves your computer.", Open Sieve (white; signs in with Google) and Try on a real computer (outline), one line under them: "Open Sieve signs you in with Google.", three numbers in the footer (46 / 1 / 44). Nav: Sieve (text, no logo), How it works, Try on a real computer, GitHub, Open Sieve (signs in, like the hero button) |
| F2 Home | `/playground` before a question; `/ask` (Ask, the signed-in home) before a question | "Ask your own data. Only one line leaves." at 104 px, one glass prompt card (850 x 262) with the question, the ladder inside it (Answer / Excerpt / Full), the Nano pill, a big white Ask; three sample chips below; Requests (badge) and What has AI seen? top right, Try now white. On `/`, while indexing runs or is paused, the Sources indexing row (small glass card: title, progress bar, one line that says what it works on now ("Reading 7 PDFs", "Making the search index", "Sorting 10 items with Gemini Nano", "Checking for personal details", "Describing 12 photos with Gemini Nano"), done of total, ETA; on battery "Paused on battery. Plug in, or press Resume to index anyway." with a Resume button) sits under the chips, as wide as the prompt card |
| F3 Ask | `/playground` and `/ask` after a question | A 280 px rail (Sieve, New ask, Try on a real computer, Recent, Control: Requests, What has AI seen?, Sources, Settings, the Nano meter at the bottom), the conversation centred at 820 px: your question as a bubble, "Searched 46 items on this computer, picked 1", the item chip, the answer at 24 px with the ribbon behind it, then the gate card: "Send this to Gemini in the cloud?", the ladder, the exact text, Approve (blue) / Keep it here; after approval the receipt chip, Gemini's draft, Copy the draft, Undo. A follow-up pill at the bottom |
| F4 How it works | `/how` (public) and a link from the chat | "How Sieve works": the statement on the left and the 16:9 video card on the right (a still placeholder with "Video coming soon" until the video exists), then the white paper in one glass card (15 sections, 4 figures, 5 tables) with a sticky "On this page" rail that marks the section being read; under 1040 px the rail becomes a folded list at the top of the paper |
| F5 Console | `/requests`, `/seen`, `/sources`, `/settings` | The same rail as the chat; Requests = the pending card with Searched / Picked / Would leave cells and the exact text, Approve (blue) / Decline; Seen = four big numbers and the receipts table (Question, Assistant, Step, Chars, When); Sources = the indexing row (the same lines as F2), three cards (Gmail live, Documents indexing, Photos captioned), an Add row and the switch "Describe photos with Gemini Nano" (on by default; photos are described on power only); Settings = category rules as toggles, assistants with caps, Connect an assistant; next to Revoke on each assistant, the testing switch "Auto-approve answers" (answer only, 2 hours, this computer only; "Auto-approving until {time}" and Stop while on; 40 section 13.8.9) |
| F6 Try | `/try` | Left: "A Mac mini with Gemini Nano already set up. Yours for five minutes.", two seat rows with status dots, Take seat 1 (white) / Join the queue; right: the viewer frame (16:10), the lease bar (time left, Full screen, Extend 5 min, End session), three facts |
| F6A Full screen | `/try`, full-screen state | The seat's screen fills the window; one glass pill at the bottom: Seat 1, time left, Extend 5 min, End session, Exit full screen |
| F7 Side panel | the extension | 400 px, black with the grid, Sieve + "Home base online", the request card with the real copy (A request is waiting, How much to share: Answer only / Excerpt / Full item, Exactly what will be sent, characters and redactions, no hidden instructions flagged, "Approve only if you asked X for this", Approve (blue) / Deny, the footnote), footer with the shortcut and Open Sieve. No Recents |
| F8 Extension in Chrome | the extension | The toolbar icon (a small dotted sphere) with the red "1" badge, the Chrome notification "A request is waiting / X is asking for something. Review it in Sieve.", the panel docked right; states: request waiting, no requests waiting, Sieve isn't open, done |
| F8B After Approve | the extension | The rest of the card fades (0.35 s), the approved text lifts out of the panel along a dotted blue trail (1.1 s), the badge clears, a ring draws then a green check, "Sent N characters to X. Receipt saved in What has AI seen?" rises with Done and Open the receipt. About 2.5 s, no sound |

Entry points: everyone signs in and uses their own data. No screen links to `/playground`; it is the demo seats' screen (Chrome in kiosk mode on `/playground?seat=1`, 80 section 74), and Try on a real computer is the only demo. Where a screen used to offer the Playground (Try, Not found, the Ask notices, the model setup), it now offers Open Sieve, the model setup or Settings.

First-run setup (`/setup`, 40 section 13.3) uses the F5 glass cards, one per step, in this order: 1 Connect your data (Gmail and Local folder, with live progress; indexing runs in the background from here), 2 Prepare the on-device model (the download keeps going in the background), 3 Make this computer your home base, 4 Get told when an AI asks.

## Copy that stays as it is in the code

The extension's labels (`extension/src/shared/labels.ts`) and the ladder labels in `shared/` are the words; the design uses them verbatim. The web app's strings live in `web/src/copy/`; the headline and the chips above are new copy there.
