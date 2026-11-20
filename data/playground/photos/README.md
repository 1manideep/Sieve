# Playground photos

The ten files here are **placeholders**: simple drawings made by `tools/photos.py`, each with its caption written on it and a "PLACEHOLDER" tag. They make the Playground work end to end today. Before submission, Mani replaces each one with a free-to-use picture he picks (00 section 10, D10), funny ones where the story allows (the hot dog photo is the demo's big moment).

| Id | File | What the final picture should show (from `photos.json`) |
|---|---|---|
| pg-photo-01 | IMG_4821.jpg | One adult at a Fourth of July cookout, cheeks puffed, five hot dogs sticking out of their mouth, holding a paper plate; red, white and blue bunting behind. |
| pg-photo-02 | IMG_4822.jpg | A folding table with trays of hot dogs and buns, mustard and ketchup, and a hand-written HOT DOG CONTEST sign. No people. |
| pg-photo-03 | IMG_3310.jpg | An empty living room with stacked moving boxes, a rolled-up rug and bare wood floors. No people. |
| pg-photo-04 | IMG_5007.jpg | A birthday cake with lit candles on a restaurant table, plates and glasses around it, no faces. |
| pg-photo-05 | IMG_5120.jpg | A city skyline at sunset from a lakefront path, an empty bench in front. No people. |
| pg-photo-06 | IMG_5133.jpg | The cabinet under a kitchen sink: a dripping pipe joint, a small bucket catching water. |
| pg-photo-07 | IMG_5201.jpg | A beagle mix puppy on a blanket at an outdoor pet adoption event, a paper tag on its collar. No faces. |
| pg-photo-08 | cat-on-windowsill.png | A gray tabby cat asleep on a sunny windowsill next to a potted plant (stays a PNG). |
| pg-photo-09 | IMG_5250.jpg | A bowl of turkey chili topped with shredded cheddar and green onions on a wooden table. |
| pg-photo-10 | IMG_5302.jpg | A red bicycle locked to a lamp post on a sidewalk covered in autumn leaves. No people. |

## Rules for the pictures

- A licence that allows reuse in a public repository: CC0, public domain, CC BY or CC BY-SA (credit the author in `SOURCES.md`), the Unsplash License or the Pexels License. Never NonCommercial (NC) or NoDerivatives (ND) licences, never stock photos with paid licences.
- No logos, trademarks or readable brand names; no documents, screens, licence plates or house numbers.
- Avoid identifiable people unless the licence covers it (the hot dog photo can show a person; prefer one whose face is mostly hidden by the hot dogs, or a picture whose licence clearly allows it). No friends, family or real addresses.
- The story fixes the dates and places, not the picture: the build writes the made-up date and GPS from `photos.json` into the file and drops everything the original carried.

## How to swap one photo

1. Download the picture into `photos/originals/` (this folder is git-ignored) and name it with the **same stem** as the file it replaces, any image extension: for example `photos/originals/IMG_4821.jpg` or `IMG_4821.png`. Keep the file name in `photos.json` as it is.
2. Edit `captions.json`: set that photo's `caption` to one sentence that truthfully describes the new picture (spec 20 section 19.4 has the target captions; drop "A drawing of"), keep `captionBy: "seed"`, set `madeBy: "hand-written"` and `madeAt` to today's date. If the new picture does not match the story (for example no five hot dogs), pick another picture rather than bending the caption.
3. Edit the photo's row in `SOURCES.md`: what it shows, the source (page URL and author, or "photo by Mani") and the licence. Remove the word "placeholder".
4. Rebuild and check, from `data/playground/tools/`:

   ```
   .venv/bin/python build.py
   .venv/bin/python validate.py
   node ../../../scripts/check-repo.mjs
   ```

   The build makes the photo upright, at most 1600 px on the long side and at most 600 KB, strips the original metadata, writes the made-up EXIF (and the XMP city for pg-photo-05), makes the 320 px thumbnail and refreshes `seed-bundle.json` (size, hash, width and height). `manifest.json` then lists the photo under `originals` instead of `placeholders`.
5. When all ten are swapped, run the `/dev/seed` page on the demo Mac (20 section 18.5) so the bundle gets on-device captions where the image model is right, the embeddings and the model privacy stages, and run `node scripts/check-repo.mjs --strict`, which fails while any placeholder remains.

The pictures in `photos/originals/` never leave the computer; only the processed copies here are committed.
