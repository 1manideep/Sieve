"""Everything in the Playground dataset that is not an email: constants, documents, photos,
the suggested questions and the bench task map. Source of documents/documents.json,
photos/photos.json, questions.json and manifest.json.

Document contents live in their own files (documents/*.md|.txt|.json and documents/src/*.txt).
Photo captions live in data/playground/captions.json (edited by hand when a photo is swapped).
"""

# docs/spec/20-index-and-sources.md section 18.1. SEED_VERSION in web/src/playground/seed.ts
# must equal this; bump both when anything in data/playground changes after browsers have seeded.
SEED_VERSION = 'pg-2026-11-16.2'
PLAYGROUND_NOW = '2026-11-17T09:00:00-06:00'      # a Tuesday; "last month" is October 2026
EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'       # 01 section 1
PREVIEW_CHARS = 280                               # 01 section 1
PROMPT_VERSIONS = {'label': 1, 'caption': 1}      # 10 section 3 (PROMPT_VERSIONS)
STAGE_VERSIONS = {'validators': 'validators@1', 'patterns': 'patterns@1'}   # 11 section 2.2

# Fixed time stamped on every precomputed field (indexedAt, enrich and privacyScan `at`), so a
# rebuild from the same sources is byte-identical. It is PLAYGROUND_NOW, not the real build time.
STAMP_AT = PLAYGROUND_NOW

# Spec 20 section 19.3.
DOCUMENTS = [
    {'id': 'pg-doc-01', 'file': 'Lease_2026.pdf', 'kind': 'document', 'category': 'Home',
     'date': '2025-12-10T16:00:00-06:00', 'pdfFrom': 'src/Lease_2026.txt'},
    {'id': 'pg-doc-02', 'file': 'Renters_Insurance_2026.pdf', 'kind': 'document', 'category': 'Money',
     'date': '2026-01-04T11:00:00-06:00', 'pdfFrom': 'src/Renters_Insurance_2026.txt'},
    {'id': 'pg-doc-03', 'file': 'packing-list-seattle.md', 'kind': 'note', 'category': 'Travel',
     'date': '2026-11-15T20:00:00-06:00'},
    {'id': 'pg-doc-04', 'file': 'chili-recipe.txt', 'kind': 'note', 'category': 'Personal',
     'date': '2026-11-07T17:30:00-06:00'},
    {'id': 'pg-doc-05', 'file': 'chat-jordan-ellis.json', 'kind': 'document', 'category': 'Personal',
     'date': '2026-11-12T19:10:00-06:00'},
    {'id': 'pg-doc-06', 'file': 'q4-goals.md', 'kind': 'note', 'category': 'Work',
     'date': '2026-10-01T09:00:00-05:00'},
]

# Spec 20 section 19.4. `description` says what the final picture should show (it guides the
# owner's pick); the caption in captions.json says what the current file shows. `gps` is an
# addition to spec 20's SeedPhoto (needed to write the EXIF and for check:repo to compare it).
# GPS points are synthetic points in public places; they exist only to show location removal.
PHOTOS = [
    {'id': 'pg-photo-01', 'file': 'IMG_4821.jpg', 'date': '2026-07-04T15:42:00-05:00', 'hadGps': True,
     'gps': {'lat': 41.9030, 'lon': -87.7010}, 'scene': 'hotdog_person',
     'description': 'One adult at an outdoor Fourth of July cookout in a park, cheeks puffed, five hot dogs sticking out of their mouth, holding a paper plate; red, white and blue bunting on a folding table behind. Only this person in frame.'},
    {'id': 'pg-photo-02', 'file': 'IMG_4822.jpg', 'date': '2026-07-04T15:10:00-05:00', 'hadGps': True,
     'gps': {'lat': 41.9031, 'lon': -87.7012}, 'scene': 'hotdog_table',
     'description': 'A folding table with trays of hot dogs and buns, mustard and ketchup bottles, and a hand-written sign reading HOT DOG CONTEST. No people.'},
    {'id': 'pg-photo-03', 'file': 'IMG_3310.jpg', 'date': '2025-03-02T11:20:00-06:00', 'hadGps': False,
     'scene': 'moving_boxes',
     'description': 'An empty apartment living room with stacked moving boxes, a rolled-up rug and bare wood floors. No people.'},
    {'id': 'pg-photo-04', 'file': 'IMG_5007.jpg', 'date': '2026-09-19T19:30:00-05:00', 'hadGps': False,
     'scene': 'birthday_cake',
     'description': 'A birthday cake with lit candles on a restaurant table, plates and glasses around it, no faces.'},
    {'id': 'pg-photo-05', 'file': 'IMG_5120.jpg', 'date': '2026-10-10T18:05:00-05:00', 'hadGps': True,
     'gps': {'lat': 41.9176, 'lon': -87.6266}, 'place': 'Chicago', 'scene': 'skyline',
     'description': 'A city skyline at sunset from a lakefront path, an empty bench in the foreground. No people.'},
    {'id': 'pg-photo-06', 'file': 'IMG_5133.jpg', 'date': '2026-09-13T20:15:00-05:00', 'hadGps': False,
     'scene': 'sink_leak',
     'description': 'The cabinet under a kitchen sink: a dripping pipe joint, a small bucket catching water, cleaning bottles pushed aside.'},
    {'id': 'pg-photo-07', 'file': 'IMG_5201.jpg', 'date': '2026-11-01T13:40:00-06:00', 'hadGps': True,
     'gps': {'lat': 41.9083, 'lon': -87.6773}, 'scene': 'puppy',
     'description': 'A beagle mix puppy on a blanket at an outdoor pet adoption event, a paper tag on its collar. No faces of people.'},
    {'id': 'pg-photo-08', 'file': 'cat-on-windowsill.png', 'date': '2026-10-18T10:05:00-05:00', 'hadGps': False,
     'scene': 'cat_window',
     'description': 'A gray tabby cat asleep on a sunny windowsill next to a potted plant.'},
    {'id': 'pg-photo-09', 'file': 'IMG_5250.jpg', 'date': '2026-11-07T19:00:00-06:00', 'hadGps': False,
     'scene': 'chili_bowl',
     'description': 'A bowl of turkey chili topped with shredded cheddar and green onions on a wooden table.'},
    {'id': 'pg-photo-10', 'file': 'IMG_5302.jpg', 'date': '2026-11-14T16:30:00-06:00', 'hadGps': True,
     'gps': {'lat': 41.9105, 'lon': -87.6770}, 'scene': 'bicycle',
     'description': 'A red bicycle locked to a lamp post on a sidewalk covered in autumn leaves. No people.'},
]

# Spec 20 section 19.5 (40 owns the chips; this lists what each depends on, for tests and the bench).
# Ids are seed ids; the IndexRecord id is 'playground:' + seed id.
SUGGESTIONS = [
    {'id': 'landlord', 'chip': True, 'text': 'What did my landlord say about the deposit? Draft a reply.',
     'expectTop': 'pg-mail-02', 'expectInTopK': ['pg-mail-02'], 'expectInTopKAnyOf': ['pg-mail-01', 'pg-mail-03'],
     'chunkMustCover': 'We received your security deposit of $1,200 on March 3.',
     'distractors': ['pg-mail-12', 'pg-mail-29', 'pg-doc-01'], 'category': 'Home', 'rule': 'approve',
     'expectedAnswer': 'Your deposit was $1,200, paid on March 3.'},
    {'id': 'hotdog', 'chip': True, 'text': 'Find the photo where I had five hot dogs in my mouth',
     'expectTop': 'pg-photo-01', 'matchedBy': 'caption', 'expectInTopK': ['pg-photo-01', 'pg-photo-02'],
     'chunkMustCover': None, 'distractors': ['pg-mail-23'], 'category': 'Photos', 'rule': 'approve'},
    {'id': 'bank', 'chip': True, 'text': "What's my latest bank balance?",
     'expectTop': 'pg-mail-11', 'expectInTopK': ['pg-mail-11', 'pg-mail-12'],
     'chunkMustCover': 'Ending balance: $3,482.17', 'distractors': ['pg-mail-14'], 'category': 'Money', 'rule': 'ask-first'},
    {'id': 'health', 'chip': True, 'text': 'What do my test results say?',
     'expectTop': 'pg-mail-15', 'expectInTopK': ['pg-mail-15'],
     'chunkMustCover': None, 'distractors': ['pg-mail-16'], 'category': 'Health', 'rule': 'never',
     'note': 'never: title and sender only, no chunk'},
    {'id': 'parcel', 'chip': True, 'text': 'What does the parcel delivery email want?',
     'expectTop': 'pg-mail-30', 'expectInTopK': ['pg-mail-30'],
     'chunkMustCover': 'Pay the $2 redelivery fee', 'distractors': ['pg-mail-07', 'pg-mail-21'],
     'category': 'Shopping', 'rule': 'approve'},
    {'id': 'mytest', 'chip': True, 'text': 'What does my test email want?',
     'expectTop': None, 'dynamic': 'the newest test-email-* upload', 'expectInTopK': [],
     'chunkMustCover': None, 'distractors': ['pg-mail-15'], 'category': None, 'rule': 'as labelled',
     'note': '"test" also matches pg-mail-15, so the expectation is top 5, with top 1 checked and reported'},
    {'id': 'upload', 'chip': True, 'text': 'What does {file name} say?',
     'expectTop': None, 'dynamic': 'the newest file upload', 'expectInTopK': [],
     'chunkMustCover': None, 'distractors': [], 'category': None, 'rule': 'as labelled'},
    {'id': 'dog', 'chip': False, 'text': 'Can I have a dog, and is there a fee?',
     'expectTop': 'pg-doc-01', 'expectInTopK': ['pg-doc-01'], 'chunkMustCover': '12. Pets.',
     'distractors': ['pg-doc-05', 'pg-mail-25', 'pg-photo-07', 'pg-doc-02'], 'category': 'Home', 'rule': 'approve'},
    {'id': 'flight', 'chip': False, 'text': 'When does my flight to Seattle leave?',
     'expectTop': 'pg-mail-19', 'expectInTopK': ['pg-mail-19', 'pg-mail-20'],
     'chunkMustCover': 'departs Chicago (ORD) on Friday, December 4 at 7:45 AM',
     'distractors': ['pg-doc-03'], 'category': 'Travel', 'rule': 'approve'},
    {'id': 'order', 'chip': False, 'text': 'Where is order #88231?',
     'expectTop': 'pg-mail-21', 'matchedBy': 'keyword', 'expectInTopK': ['pg-mail-21'],
     'chunkMustCover': 'order #88231 has shipped', 'distractors': ['pg-mail-22'],
     'category': 'Shopping', 'rule': 'approve', 'note': 'keyword safety net with hints.terms ["88231"]'},
]

# The bench tasks and canaries (60 sections 4.8 and 4.8.2) live in bench/tasks.json and
# bench/canaries.json; build.py and scripts/check-repo.mjs check them against this dataset.
