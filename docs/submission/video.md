# Sieve: the demo video

The plan for the #BuildHybridAI 2026 demo video: constraints, recording setup, shot list, narration, on-screen captions, subtitles, upload and the checks before uploading. Sources: `docs/spec/60-testing-bench-submission.md` section 6, and `docs/spec/00-overview.md` decisions D2 (Gemini CLI for the relay, no third-party assistant on screen) and D3 (the Wi-Fi-off proof shot). Where they differ, D2 and D3 win.

When the edit is final, the narration below becomes `docs/video/script.md` and the subtitles become `docs/video/sieve-demo.en.srt` (60 sections 6.4 and 6.5).

## Constraints

- At most 3:00; aim for about 2:55. Only the first 3 minutes may be evaluated.
- Public on YouTube. English narration plus uploaded English subtitles (not only automatic captions).
- Shows Sieve working in Chrome on the web platform.
- Sample data only. No other company's logo, assistant interface or advertising on screen. Google's own products (Chrome, Gemini CLI) are fine, since Google is the sponsor.
- No number about data exposure appears, spoken or on screen, unless it comes from the bench's `summary.json` (60 section 4.12).
- No connector link, token, key, personal email address or real mail on screen, ever.

## Recording setup

| Item | Setting |
|---|---|
| Machine | The demo Mac, Chrome stable 139 or later, Nano `available` (check `chrome://on-device-internals` before recording), the multimodal flag on |
| Chrome profile | A new profile "Sieve demo": only the Sieve extension, pinned; bookmarks bar hidden; default theme; page zoom 110 percent; window about 1600 by 1000 |
| Segments 0:12 to 1:50 | The hosted Playground (`https://sieve.manideep.info/playground`), Reset before each take, release build of the extension |
| Offline shot | Same Playground. Before turning Wi-Fi off: ask one question online so the embedding model and warm sessions are loaded. The proof on screen is Sieve's own offline banner and the trace, not the macOS menu bar |
| Relay segment | Gemini CLI in a plain Terminal window beside Chrome. Point it at the bench stack (`npm run bench:stack`, 60 section 4.7), so the home base serves Playground sample data; the connector link of the `Bench assistant` grant goes into a throwaway folder's `.gemini/settings.json` as `{"mcpServers": {"sieve": {"httpUrl": "<link>"}}}`, never into the repo. Use the extension's `dev` build. Small caption: "Local test setup, sample data" |
| Gemini CLI on screen | Plain Terminal theme, large font. Hide anything that shows an account email or a home folder path; never run `/mcp` on camera (it can print the link) |
| Capture | macOS Screenshot toolbar (Shift-Command-5), "Record Selected Portion" around the Chrome window (and the Terminal window for the relay) only: no menu bar, no Dock, no other apps |
| Notifications | macOS Focus on for everything except Chrome, so only the extension's notice can appear |
| Voice | Recorded separately with QuickTime in a quiet room, from the narration below, about 150 words a minute |
| Edit | Any editor that adds no watermark (iMovie is fine). Cuts and crops for zoom. Cut waiting time with a visible cut; never speed up or fake an answer. No music |
| Export | 1080p, H.264, 30 fps |
| Text overlays | Inter, short, in the app's colours (teal for on-device, blue for cloud) |

## Shot list

| Time | Segment | On screen | Caption on screen |
|---|---|---|---|
| 0:00 to 0:12 | The problem | Title card "Give AI the answer, not your inbox." over a simple diagram: an assistant opening many envelopes to use one | `Give AI the answer, not your inbox.` |
| 0:12 to 0:55 | Golden path | The Playground opens with no login; status strip "On-device model ready"; the chip "What did my landlord say about the deposit? Draft a reply."; Nano streams the answer on the device; the ladder with the exact text for Answer, Excerpt and Full item; approve the answer only; the cloud draft from that one sentence; the two-lane trace ("This device · Gemini Nano", "Cloud · Gemini") with the characters that crossed; the receipt in "What has AI seen?" | `On this device: found and answered`, then `Cloud: drafted from 1 approved sentence` |
| 0:55 to 1:12 | Wi-Fi off (D3) | Turn Wi-Fi off (cut, off screen); Sieve's banner "You're offline. Sieve still searches this device."; type "When does my flight to Seattle leave?"; Nano answers; zoom on the trace: "This device · Gemini Nano" and "Nothing left this device"; the step's details: "The Firebase SDK reported: on this device". Wi-Fi back on after the take | `Wi-Fi off. Answered on this device.` |
| 1:12 to 1:32 | The booby-trapped email | The parcel email; the "Hidden text removed" view showing the removed instruction; the chip "What does the parcel delivery email want?"; the warning flag; the outgoing answer has none of the hidden text | `Hidden instruction removed before any model read it` |
| 1:32 to 1:50 | Photo search | The chip "Find the photo where I had five hot dogs in my mouth"; the on-device caption match; only that photo offered; "location removed" | `Only this photo, location removed` |
| 1:50 to 2:25 | The relay (D2) | Terminal with Gemini CLI beside Chrome: "Use Sieve to find my landlord's email about the deposit and draft a reply."; Gemini CLI calls `sieve_answer`; the Sieve badge lights; the side panel opens beside the current tab; Answer only; Approve; Gemini CLI shows the answer and its draft | `Gemini CLI asks. You approve next to any tab.` and, small, `Local test setup, sample data` |
| 2:25 to 2:47 | The measured number | The README bench table, zoomed on the measured rows | Only the lines from the bench's `lines` command |
| 2:47 to 2:57 | Links | `sieve.manideep.info/playground`, `github.com/1manideep/Sieve`, "Built with Firebase AI Logic" | The links |

If the bench has no complete run set by Nov 27, cut 2:25 to 2:47 and end with the links at about 2:35. Never narrate a number that is not in `summary.json`.

## Narration

Plain English, short sentences, about 400 words. Bracketed lines are stage notes, not read aloud.

**0:00 The problem**

To find one email, an assistant connected to your inbox searches and reads widely. That includes mail written by strangers, and any of it can carry instructions. Sieve gives AI the answer, not your inbox.

**0:12 Golden path**

This is the Sieve Playground: a pretend computer with sample mail, photos and documents. No login. The on-device model is ready. I ask what my landlord said about the deposit, and to draft a reply. Gemini Nano, through Firebase AI Logic, finds the email and writes the answer right here in Chrome. Sieve shows exactly what would leave at each step: the answer, an excerpt, or the full email. I approve the answer only. Gemini in the cloud drafts the reply from that one sentence. The trace shows every step, where the SDK says it ran, and what crossed to the cloud. And the receipt is in "What has AI seen?".

**0:55 Wi-Fi off**

Is it really on the device? I turn Wi-Fi off. Sieve says I'm offline. I ask when my flight to Seattle leaves. Nano still answers, and the trace says: this device, nothing left this device.

**1:12 The booby-trapped email**

This parcel email hides an instruction for the AI in invisible text. Plain code removes hidden text before any model reads it. Nano flags what is left. And at the answer step, the assistant gets a sentence written on your device, not the stranger's words.

**1:32 Photo search**

Find the photo where I had five hot dogs in my mouth. Photos are captioned on the device, so finding one means sharing one. Only this photo is offered, with its location removed.

**1:50 The relay**

Any assistant that supports MCP connectors can ask Sieve. Here it is Gemini CLI, Google's open-source command-line assistant, asking through the Sieve connector. My Sieve tab does the private work on this computer. The badge lights up. In the side panel, next to whatever tab I'm on, I see exactly what would be sent. Answer only. Approve. The preview never passed through the server, and the assistant gets one sentence.

**2:25 The measured number**

[Only the sentences printed by the bench's `lines` command for the final run set. In `docs/video/script.md` each one ends with the `<!-- bench -->` marker. If there is no run set, cut this segment.]

**2:47 Links**

Try the Playground at sieve dot manideep dot info. It needs no login. Sieve: give AI the answer, not your inbox. Built with Firebase AI Logic.

## Subtitles

A draft of `docs/video/sieve-demo.en.srt`. The times follow the shot list and must be retimed to the final edit; every cue must match the audio word for word. If the measured-number segment is cut, drop cues 21 and 22 and move the last two cues to start at 00:02:25.

```srt
1
00:00:00,500 --> 00:00:05,000
To find one email, an assistant connected
to your inbox searches and reads widely.

2
00:00:05,000 --> 00:00:09,000
That includes mail written by strangers,
and any of it can carry instructions.

3
00:00:09,000 --> 00:00:12,000
Sieve gives AI the answer, not your inbox.

4
00:00:12,000 --> 00:00:17,500
This is the Sieve Playground: a pretend computer
with sample mail, photos and documents. No login.

5
00:00:17,500 --> 00:00:23,000
The on-device model is ready. I ask what my landlord
said about the deposit, and to draft a reply.

6
00:00:23,000 --> 00:00:29,000
Gemini Nano, through Firebase AI Logic, finds the email
and writes the answer right here in Chrome.

7
00:00:29,000 --> 00:00:35,000
Sieve shows exactly what would leave at each step:
the answer, an excerpt, or the full email.

8
00:00:35,000 --> 00:00:42,000
I approve the answer only. Gemini in the cloud
drafts the reply from that one sentence.

9
00:00:42,000 --> 00:00:50,000
The trace shows every step, where the SDK says it ran,
and what crossed to the cloud.

10
00:00:50,000 --> 00:00:55,000
And the receipt is in "What has AI seen?".

11
00:00:55,000 --> 00:01:01,000
Is it really on the device? I turn Wi-Fi off.
Sieve says I'm offline.

12
00:01:01,000 --> 00:01:12,000
I ask when my flight to Seattle leaves. Nano still answers,
and the trace says: this device, nothing left this device.

13
00:01:12,000 --> 00:01:18,000
This parcel email hides an instruction
for the AI in invisible text.

14
00:01:18,000 --> 00:01:24,000
Plain code removes hidden text before any model
reads it. Nano flags what is left.

15
00:01:24,000 --> 00:01:32,000
And at the answer step, the assistant gets a sentence
written on your device, not the stranger's words.

16
00:01:32,000 --> 00:01:38,000
Find the photo where I had five hot dogs in my mouth.

17
00:01:38,000 --> 00:01:50,000
Photos are captioned on the device, so finding one means sharing one.
Only this photo is offered, with its location removed.

18
00:01:50,000 --> 00:02:01,000
Any assistant that supports MCP connectors can ask Sieve. Here it is
Gemini CLI, Google's open-source command-line assistant.

19
00:02:01,000 --> 00:02:12,000
My Sieve tab does the private work on this computer. The badge lights up.
In the side panel, next to whatever tab I'm on, I see exactly what would be sent.

20
00:02:12,000 --> 00:02:25,000
Answer only. Approve. The preview never passed through the server,
and the assistant gets one sentence.

21
00:02:25,000 --> 00:02:36,000
[bench line 1, copied from the lines command output]

22
00:02:36,000 --> 00:02:47,000
[bench line 2, copied from the lines command output]

23
00:02:47,000 --> 00:02:52,000
Try the Playground at sieve.manideep.info. It needs no login.

24
00:02:52,000 --> 00:02:57,000
Sieve: give AI the answer, not your inbox.
Built with Firebase AI Logic.
```

## Upload

| Field | Value |
|---|---|
| Visibility | Public |
| Title | `Sieve: give AI the answer, not your inbox (#BuildHybridAI 2026)` |
| Description | Two sentences on what Sieve does, then the Playground link, the repo link, and chapter times matching the shot list |
| Audience | Not made for kids |
| Altered or synthetic content | Answer YouTube's question from `data/playground/SOURCES.md`: "yes" if any final sample photo of a realistic person is AI-generated, otherwise "no" |
| Category | Science & Technology |
| Thumbnail | A frame of the side panel with the ladder; no third-party logos |
| Subtitles | Upload `docs/video/sieve-demo.en.srt` as English in YouTube Studio |

Description draft (fill in the chapter times from the final edit):

```
Sieve gives AI assistants the answer, not your inbox. Gemini Nano finds what a request needs on your own computer, through Firebase AI Logic, and you approve exactly what leaves.

Try the Playground (no login): https://sieve.manideep.info/playground
Code: https://github.com/1manideep/Sieve

0:00 The problem
0:12 Asking in the Playground
0:55 Wi-Fi off
1:12 A booby-trapped email
1:32 Finding a photo
1:50 An outside assistant asks
```

## Before uploading

1. Duration at most 3:00.
2. Every frame checked: no logos except Chrome's own interface and Google's Gemini CLI, no macOS menu bar or Dock, no third-party sites, no personal tabs, no real mail, no account email in the Terminal, no connector link.
3. The Wi-Fi-off take really ran offline: the offline banner is visible and the trace says "This device · Gemini Nano" and "Nothing left this device".
4. Subtitles uploaded and correct, cue by cue against the audio.
5. Every number on screen or in the narration matches `summary.json`. With no complete run set, the measured-number segment is cut.
6. The link opens while logged out of YouTube.
7. The YouTube link is added to the README's Video section and to the Devpost form.
