# Sieve: submission checklist

The official rules of #BuildHybridAI 2026, item by item (`docs/spec/60-testing-bench-submission.md` section 8.4), with the state of each on Nov 18, 2026. Tick an item only when its evidence exists. Deadline: Mon Nov 30, 2026, 2:00 PM PT. Plan: submit Sun Nov 29 and tag the submitted commit. Production stays frozen and running until judging ends on Dec 16, 2026, 2:00 PM PT.

## Pending today

- [ ] **Deploy** to the Firebase project `sieve-manideep`: Hosting, Functions, Firestore rules and indexes, Realtime Database rules. Merge `dev` to `main` first; deploys come from `main`.
- [ ] **Custom domain**: point `sieve.manideep.info` at Firebase Hosting. Until then the site is only at `sieve-manideep.web.app`, and every link in the README, Devpost text and video points at the custom domain.
- [ ] **Chrome Web Store**: submit the extension by Mon Nov 24 (text in `extension/store/listing.md`). Until the listing is live, judges install `sieve-extension-<version>.zip` from a GitHub release, which does not exist yet.
- [ ] **Video**: record and edit Nov 27 per `docs/submission/video.md`, upload publicly, add the link to the README's Video section and the Devpost form.
- [ ] **Bench run**: first run set Nov 23 or 24, final set Nov 26 on the code to be submitted; then `npm run bench:report -- --set <id> --update-readme`. After that, delete the README's empty "This is the table the bench fills in" table, add the generated lines to the Devpost text and the video.
- [ ] **Photo swap**: replace the ten placeholder drawings in `data/playground/photos/` with free-to-use pictures and fill in their rows in `data/playground/SOURCES.md` (`check:repo` warns on each one today).

## The official rules

- [ ] **1. Eligibility (rules section 3).** Age of majority, not a resident of an excluded country, not an employee, intern or contractor of Google or Devpost or their household, no conflict of interest. Owner: Mani. Today: to confirm.
- [ ] **2. How to enter (5).** Devpost account, joined the hackathon, every required field filled. Owner: Mani. Today: to do at submission.
- [ ] **3. What to create (6).** A Gen AI app using Firebase AI Logic with supported Firebase products. Sieve: AI Logic hybrid inference plus App Check, Authentication and Firestore. Evidence: `web/src/ai/init.ts`, `web/src/ai/hybrid.ts`; README "Where the Firebase AI Logic calls live" and "Firebase products used, and why". Today: in the code and the README; to confirm on the deployed site.
- [ ] **4. Platform (6).** Web (Chrome) with Gemini Nano through Firebase AI Logic; a web app or Chrome extension. Sieve: the web app plus a thin extension. Today: built; waits for the deploy and the video.
- [ ] **5. App Check (6).** Required for AI Logic; debug tokens accepted. Sieve: reCAPTCHA Enterprise in `web/src/ai/init.ts`; the debug token only in local env files. Today: code done; register the hosted domains and enforce App Check in the console, then test the hosted Playground in Incognito, Guest and a fresh profile. The secret scan in `check:repo` is not written yet.
- [ ] **6. Functionality (6).** Installs and runs consistently, and works as shown in the video and the text. Sieve: the manual checklist (60 section 3.11) on Nov 28 against the hosted site, logged in `docs/testing/manual-log.md` (not created yet). Today: pending.
- [ ] **7. New and existing projects (6).** New during the period, pre-existing work disclosed, a summary of what was built. Evidence: the first commit is Nov 15, 2026 (checked with `git log`); README "Built during the hackathon" and the Devpost section. Today: text written; Mani confirms the Ratchet wording (when it was started and first published).
- [ ] **8. Third-party integrations (6).** Authorized use of SDKs, APIs and data. Sieve: Gmail API under Google's terms in OAuth testing mode; npm and PyPI licenses; OFL fonts; CC BY 4.0 PII model; made-up data. Evidence: README "Pre-existing work" and "License". Today: written; waits for the photo swap and the invented-name check in `data/playground/NAMES.md` (20 names still unchecked).
- [ ] **9. Testing access (6).** A working link, free and unrestricted until Dec 16, 2026, 2:00 PM PT. Sieve: the hosted Playground, no login, frozen and checked every two days. Today: waits for the deploy and the domain.
- [ ] **10. No secrets or PII (6).** No production keys, live project secrets, confidential data or PII in the repo, form or instructions. Sieve: Firebase config and tokens in git-ignored env files (`.env.*` in `.gitignore`); no real people in photos; the testing text has no connector link or token. Today: config is env-only; the secret scan in `check:repo` is still to add; run it on the tagged commit.
- [ ] **11. Language (6).** English. Today: app and documents are in English; English subtitles wait for the video.
- [ ] **12. Multiple submissions (6).** One submission. Owner: Mani.
- [ ] **13. Ownership and IP (6).** Original work; open source used under its licenses. Evidence: README "Pre-existing work"; Ratchet is Mani's own. Today: written; Mani confirms.
- [ ] **14. Financial or preferential support (6).** None from Google or Devpost. Owner: Mani confirms.
- [ ] **15. Select a platform (6).** Web (Chrome) in the Devpost form. Owner: Mani, at submission.
- [ ] **16. Text description (6).** How AI Logic is used, features, value proposition. Evidence: `docs/submission/devpost.md`. Today: drafted Nov 18; the measured-number heading is left out until the bench has run; paste on Nov 28 to 29.
- [ ] **17. Repository (6).** Public on GitHub; all source, assets and instructions; the value proposition; Firebase AI Logic imported and actually called at runtime. Evidence: https://github.com/1manideep/Sieve is public; the README names the files and gives `grep -rn "firebase/ai" web/src`. Today: README written on `dev`; it reaches the public repo with the merge to `main`.
- [ ] **18. License (6).** An open source license file, detectable in the About section. Evidence: the root `LICENSE` (Apache-2.0). Today: present; check that GitHub's About sidebar shows "Apache-2.0 license".
- [ ] **19. Video (6).** Shows the project working on its platform; at most 3 minutes; public on YouTube; link in the form; English or English subtitles. Evidence: `docs/submission/video.md`. Today: planned; not recorded.
- [ ] **20. Encouraged: a hosted URL (6).** `sieve.manideep.info/playground`. Today: waits for the deploy and the domain.
- [ ] **21. Content (6).** Nothing offensive or unlawful; no third-party advertising, slogan, logo, trademark or implied endorsement; no publicity, privacy or IP violation. Evidence: the video frame check; invented sample brands; licensed photos; no third-party assistant interface on screen. Today: waits for the photo swap and the name check. Note: the app's "Connect an AI" dialog names two third-party assistants (`web/src/copy/screens-controls.ts`, `quickFill` and `howTo1`); keep it off camera and out of screenshots, or change the copy.
- [ ] **22. Submission modifications (7).** Submit during the period; nothing changes after; later commits are not evaluated. Plan: submit Sun Nov 29; tag `submission-2026-11-30` on the submitted commit and push the tag; freeze production. Today: pending.
- [ ] **23. Judging Stage One (8).** Every requirement present. Today: tick when every other row is ticked.
- [x] **24. Free of charge.** No paywall; the Playground needs no account.
- [ ] **25. Winner verification (8).** Reply within 3 business days. Owner: Mani watches the Devpost email from Dec 16.

## To fix or confirm before submission

Found while writing the submission documents on Nov 18. Each one makes the README, the Devpost text or the video say something the build does not do yet.

- [ ] The Playground button "Send a test request to the extension" (50 section 11) is not in `web/src`. The README quick start, the Devpost testing text and the Web Store test instructions all rely on it.
- [ ] The Playground assistant (00 D1): `issuePlaygroundGrant` and the Playground relay exist, but the cloud Gemini side (function calling that calls the MCP endpoint) and its Playground panel were not found in `web/src`. The README and the Devpost text describe it.
- [ ] The Playground's recorded Nano clip for visitors without Nano (00 D3) was not found in `web/src`. The README does not mention it; add one line when it ships.
- [ ] Day-1 checks with no recorded result in the repo: Gemini CLI against the connector over HTTP (D2; the video's relay segment and the README compatibility line depend on it) and on-device inference with Wi-Fi off through the SDK and App Check (D3; the video's offline shot and the README depend on it).
- [ ] The Web Store listing gives the privacy policy URL `https://sieve.manideep.info/privacy`, but `firebase.json` has no `cleanUrls`, so that path falls through to the app. Use `/privacy.html` in the listing and the OAuth consent screen, or turn on `cleanUrls`.
- [ ] `extension/manifest.json` `externally_connectable` lists only `https://sieve.manideep.info/*` and localhost, so the side panel does not work from `sieve-manideep.web.app` while the domain is pending.
- [ ] `scripts/check-repo.mjs` still lacks the claims check (60 section 4.12), the secret scan and the LICENSE hash (its header says so). Add them, then run `node scripts/check-repo.mjs --strict` on the submission commit.
- [ ] The index package: `seed-bundle.json` has no vectors yet; run `/dev/seed` on the demo Mac (20 section 18.5) before the hosted Playground goes public.
- [ ] `data/playground/heldout-questions.json`, written by someone who has not read the spec (20 section 19.7).
- [ ] The manual log `docs/testing/manual-log.md` for the Nov 28 run.
- [ ] `.nvmrc` does not exist, though 60 section 7.9 refers to it; the README gives the Node version from `package.json` `engines` instead.
- [ ] The root folder `.vitest/` is untracked and not in `.gitignore`.
