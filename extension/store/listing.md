# Chrome Web Store listing: Sieve

Paste these into the Developer Dashboard (docs/spec/50-extension.md section 13). Upload
`artifacts/sieve-extension-<version>-store.zip` (built by `npm run zip -w extension`; it has no `key`).

## Store listing tab

| Field | Value |
|---|---|
| Name | Sieve (from the manifest) |
| Summary | Approve what your AI assistant may see. Requests from your open Sieve tab appear in a toolbar popup with the exact text to be sent. |
| Category | Productivity, or the closest current equivalent in the dashboard list |
| Language | English |
| Icon | `extension/public/icons/icon-128.png` |
| Screenshots (1280x800, PNG) | 1. The popup with the landlord deposit request over a plain page, Answer only selected. 2. Excerpt selected, showing the exact excerpt and a warning tag. 3. The Shared state. Playground sample data only; no third-party logos or sites in the frame. Taken by hand on the demo Mac. |
| Small promo tile | Not provided (optional) |
| Homepage URL | https://sieve.manideep.info |
| Support URL | The GitHub repository's issues page |

### Detailed description (paste as is)

```
Sieve is the approval panel for the Sieve web app (sieve.manideep.info), which lets AI assistants get only what a task needs from your email, files and photos.

When an AI assistant you connected asks Sieve for something, your open Sieve tab finds the answer on your own computer and prepares exactly what would be sent. This extension shows that request in a popup from its toolbar icon, on whatever tab you are on, and can keep it open in Chrome's side panel. The popup opens by itself when a request arrives; you can turn that off in its settings. It shows:
• who is asking and what they asked for
• the item Sieve found
• how much to share: the answer only, an excerpt, or the full item
• the exact text that would be sent, with any warnings
• Approve or Deny

The extension holds no index and runs no AI models. It talks only to your own Sieve tab on this computer, through Chrome's page-to-extension messaging, so previews never pass through a server. It keeps previews in memory only. The one thing it saves is your choice of whether the popup opens by itself.

Requires the Sieve web app open in a tab. Chrome on desktop.
```

## Privacy practices tab

### Single purpose

```
Lets the person approve or deny, from the extension's toolbar popup or Chrome's side panel, the data requests that their open Sieve web app tab has prepared for an AI assistant.
```

### Permission justifications

| Permission | Justification (paste) |
|---|---|
| sidePanel | `Lets the person keep the approval panel open next to the current tab ("Keep open on the side" in the popup), so they can review requests and approve or deny them without leaving the page they are on.` |
| notifications | `Shows a local notice that a request is waiting when Sieve's popup and side panel are closed and the popup could not open by itself. The notice names the assistant only, never the request content.` |
| storage | `Uses chrome.storage.session (memory only, cleared when Chrome closes) to remember which request ids it has already announced, so a service worker restart does not repeat a notice. Uses chrome.storage.local for one setting the person chooses (whether the popup opens when a request arrives). No request content is stored.` |

The manifest also declares one keyboard shortcut (`commands`, "Open or close Sieve"); it needs no permission.

### Remote code

"No, I am not using remote code."

### Data usage

Tick the types the panel can display: Personally identifiable information, Health information, Financial and payment
information, Personal communications. In the description field (if offered):

```
Shown in the popup or side panel from the person's own Sieve tab on the same computer. Kept in memory only, never transmitted, never stored on disk.
```

Tick the three certifications the dashboard lists (no selling or transfer to third parties, no use unrelated to the
single purpose, no use for creditworthiness or lending).

### Privacy policy URL

https://sieve.manideep.info/privacy

## Test instructions tab

```
1. Install the extension and pin it.
2. Open https://sieve.manideep.info/playground in a tab. No sign-in is needed; it uses made-up sample data.
3. Click the Sieve toolbar icon to open the popup. It shows "No requests waiting" and "Home base online" or "Sieve tab open".
4. In the Playground, click "Send a test request to the extension".
5. The badge shows 1. Click the icon again; in the popup, pick "Answer only", "Excerpt" or "Full item" and read the exact text, then press Approve.
6. The popup shows "Sent N characters to" the test assistant, and the Playground shows what the test assistant received.
```

## Distribution and timing

- Visibility: Unlisted (anyone with the link can install; it is not offered in search). Free. All regions.
- Submit by Mon Nov 24. Review can take up to a few weeks, so the submission never depends on approval: the Devpost
  entry links the GitHub release zip, and adds the store link only if it is live by Nov 29.
- Leave automatic publishing on.
- Account tasks in the dashboard: developer registration, contact email, any trader declaration the dashboard asks
  for, and the privacy tab above.
- Before uploading: replace the temporary local `key` in `extension/manifest.json` with the dashboard's public key
  (Package tab, "View public key", one line), run `npm run id -w extension`, and update `EXTENSION_ID`
  (50 section 5.2). Run `npm audit --omit=dev` before each release zip.
