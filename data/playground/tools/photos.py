"""Playground photos: placeholder drawings now, the owner's free-to-use pictures later.

For each entry in source_catalog.PHOTOS:
  - if photos/originals/<stem>.<any image extension> exists (git-ignored), it is processed:
    upright, long edge at most 1600 px, every original metadata field dropped, saved as the
    entry's file name (JPEG quality 85, lowered until it is at most 600 KB; PNG optimized);
  - otherwise a placeholder is drawn: a simple scene with its caption on it, 800 x 600,
    marked PLACEHOLDER, under 150 KB.
Then made-up metadata is written (docs/spec/20-index-and-sources.md section 19.4): JPEG EXIF
Make 'Sieve Playground', Software 'sieve-playground-build', DateTimeOriginal (Chicago local
time) and, when hadGps, the four GPS tags; pg-photo-05 also gets an XMP packet with
photoshop:City. PNG files carry no metadata. A 320 px thumbnail without metadata goes to
photos/thumbs/<stem>.jpg.

Caption text is drawn with Pillow's bundled default font (Aileron Regular, CC0).
"""
from __future__ import annotations

import io
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
from PIL.TiffImagePlugin import IFDRational

W, H = 800, 600
SCENE_H = 500
MAX_EDGE = 1600
MAX_BYTES = 600_000
PLACEHOLDER_MAX_BYTES = 150_000
THUMB_EDGE = 320
IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff')


def _font(size: int):
    return ImageFont.load_default(size=size)

# ---------------------------------------------------------------- drawing helpers

def _capsule(d: ImageDraw.ImageDraw, x0, y0, angle_deg, length, thick, fill, outline=None):
    """A rounded bar from (x0, y0) pointing at angle (0 = right, 90 = down)."""
    a = math.radians(angle_deg)
    x1, y1 = x0 + length * math.cos(a), y0 + length * math.sin(a)
    nx, ny = -math.sin(a) * thick / 2, math.cos(a) * thick / 2
    d.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=fill, outline=outline)
    r = thick / 2
    for cx, cy in ((x0, y0), (x1, y1)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=outline)
    return x1, y1


def _hotdog(d, x, y, angle, length=92):
    _capsule(d, x, y, angle, length, 30, fill=(226, 180, 112), outline=(170, 120, 60))     # bun
    _capsule(d, x, y, angle, length + 14, 15, fill=(178, 66, 48))                          # sausage
    a = math.radians(angle)
    mx, my = x + (length * 0.55) * math.cos(a), y + (length * 0.55) * math.sin(a)
    _capsule(d, mx - 16 * math.cos(a), my - 16 * math.sin(a), angle, 30, 4, fill=(240, 200, 40))  # mustard


def _sky_grass(d, horizon=330, sky=(178, 216, 240), grass=(118, 176, 88)):
    d.rectangle([0, 0, W, horizon], fill=sky)
    d.rectangle([0, horizon, W, SCENE_H], fill=grass)


def _bunting(d, x0, x1, y):
    colors = [(200, 40, 50), (250, 250, 250), (40, 70, 160)]
    d.line([(x0, y), (x1, y)], fill=(90, 90, 90), width=2)
    step = 34
    for k, x in enumerate(range(x0, x1 - step + 1, step)):
        d.polygon([(x, y), (x + step, y), (x + step / 2, y + 30)], fill=colors[k % 3], outline=(120, 120, 120))


def _table(d, x0, x1, top, cloth=(245, 245, 245), legs=(120, 120, 120)):
    d.rectangle([x0, top, x1, top + 18], fill=cloth, outline=(170, 170, 170))
    for lx in (x0 + 20, x1 - 30):
        d.rectangle([lx, top + 18, lx + 10, top + 120], fill=legs)

# ---------------------------------------------------------------- the ten scenes

def scene_hotdog_person(d, rng):
    _sky_grass(d)
    _table(d, 40, 760, 300, cloth=(250, 250, 250))
    _bunting(d, 40, 760, 300)
    # body, arm, plate
    d.rounded_rectangle([320, 300, 480, 500], radius=40, fill=(60, 110, 190))
    d.line([(470, 350), (560, 400)], fill=(233, 190, 150), width=22)
    d.ellipse([520, 380, 640, 420], fill=(255, 255, 255), outline=(150, 150, 150), width=3)
    # head with puffed cheeks
    d.ellipse([335, 150, 465, 290], fill=(233, 190, 150), outline=(180, 130, 95), width=2)
    d.ellipse([330, 215, 380, 265], fill=(240, 160, 140))
    d.ellipse([420, 215, 470, 265], fill=(240, 160, 140))
    d.ellipse([368, 195, 380, 207], fill=(40, 40, 40))
    d.ellipse([420, 195, 432, 207], fill=(40, 40, 40))
    d.arc([360, 172, 390, 190], 200, 340, fill=(80, 50, 30), width=3)
    d.arc([410, 172, 440, 190], 200, 340, fill=(80, 50, 30), width=3)
    d.rounded_rectangle([335, 140, 465, 175], radius=20, fill=(90, 60, 40))   # hair
    mouth = (400, 252)
    d.ellipse([mouth[0] - 18, mouth[1] - 12, mouth[0] + 18, mouth[1] + 12], fill=(110, 40, 40))
    for ang in (35, 62, 90, 118, 145):          # five hot dogs fanning out of the mouth
        a = math.radians(ang)
        _hotdog(d, mouth[0] + 10 * math.cos(a), mouth[1] + 10 * math.sin(a), ang, 120)
    d.ellipse([mouth[0] - 18, mouth[1] - 12, mouth[0] + 18, mouth[1] + 12], outline=(110, 40, 40), width=4)


def scene_hotdog_table(d, rng):
    _sky_grass(d, horizon=260)
    _table(d, 60, 740, 300)
    for tx in (110, 420):                       # two trays of hot dogs in buns
        d.rectangle([tx, 255, tx + 250, 300], fill=(170, 170, 175), outline=(120, 120, 125), width=2)
        for k in range(5):
            _capsule(d, tx + 22 + k * 46, 290, -90, 26, 24, fill=(226, 180, 112), outline=(170, 120, 60))
            _capsule(d, tx + 22 + k * 46, 292, -90, 34, 11, fill=(178, 66, 48))
    # a pile of buns
    for k in range(4):
        d.ellipse([60 + k * 36, 230, 100 + k * 36, 256], fill=(226, 180, 112), outline=(170, 120, 60))
    # mustard and ketchup bottles
    d.rounded_rectangle([690, 200, 720, 300], radius=8, fill=(240, 200, 40))
    d.polygon([(697, 200), (713, 200), (705, 180)], fill=(240, 200, 40))
    d.rounded_rectangle([650, 200, 680, 300], radius=8, fill=(200, 40, 40))
    d.polygon([(657, 200), (673, 200), (665, 180)], fill=(200, 40, 40))
    # hand-written sign on a stick
    d.rectangle([395, 70, 405, 255], fill=(150, 110, 70))
    d.rectangle([200, 40, 600, 130], fill=(255, 252, 235), outline=(90, 90, 90), width=3)
    f = _font(34)
    d.text((400, 85), 'HOT DOG CONTEST', font=f, fill=(30, 30, 120), anchor='mm')


def scene_moving_boxes(d, rng):
    d.rectangle([0, 0, W, 330], fill=(236, 226, 205))                      # wall
    d.rectangle([0, 330, W, SCENE_H], fill=(176, 122, 72))                 # wood floor
    for y in range(340, SCENE_H, 28):
        d.line([(0, y), (W, y)], fill=(150, 100, 58), width=2)
    for x in range(0, W, 140):
        for y in range(330, SCENE_H, 56):
            d.line([(x + (y // 56 % 2) * 70, y), (x + (y // 56 % 2) * 70, y + 28)], fill=(150, 100, 58), width=2)
    d.rectangle([520, 60, 700, 220], fill=(205, 228, 245), outline=(250, 250, 250), width=10)   # window
    boxes = [(80, 370, 260, 480), (100, 270, 240, 370), (120, 190, 220, 270), (290, 380, 430, 480), (305, 300, 415, 380)]
    for x0, y0, x1, y1 in boxes:
        d.rectangle([x0, y0, x1, y1], fill=(200, 160, 105), outline=(140, 105, 60), width=3)
        d.rectangle([(x0 + x1) / 2 - 10, y0, (x0 + x1) / 2 + 10, y1], fill=(225, 200, 140))
    d.rounded_rectangle([470, 430, 760, 478], radius=24, fill=(150, 60, 60))               # rolled rug
    d.ellipse([735, 430, 783, 478], fill=(120, 45, 45), outline=(90, 30, 30), width=3)
    d.ellipse([751, 446, 767, 462], fill=(90, 30, 30))


def scene_birthday_cake(d, rng):
    d.rectangle([0, 0, W, 250], fill=(70, 50, 60))                          # dim restaurant wall
    d.rectangle([0, 250, W, SCENE_H], fill=(150, 40, 45))                   # table cloth
    for cx in (150, 650):                                                   # plates
        d.ellipse([cx - 80, 360, cx + 80, 420], fill=(250, 250, 250), outline=(200, 200, 200), width=3)
    for gx in (90, 700):                                                    # glasses
        d.polygon([(gx, 280), (gx + 40, 280), (gx + 33, 350), (gx + 7, 350)], fill=(200, 225, 240), outline=(160, 180, 200))
    d.ellipse([250, 400, 550, 460], fill=(240, 240, 240))                   # cake plate
    d.rectangle([280, 300, 520, 430], fill=(246, 190, 205))                 # cake
    d.rectangle([280, 360, 520, 372], fill=(255, 250, 250))
    d.ellipse([280, 280, 520, 320], fill=(252, 215, 225))
    for k in range(6):                                                      # lit candles
        x = 305 + k * 38
        d.rectangle([x, 230, x + 10, 300], fill=(120, 170, 230))
        d.ellipse([x - 4, 205, x + 14, 232], fill=(255, 200, 60))
        d.ellipse([x + 1, 214, x + 9, 230], fill=(255, 245, 190))


def scene_skyline(d, rng):
    for y in range(0, 330):                                                 # sunset gradient
        t = y / 330
        d.line([(0, y), (W, y)], fill=(int(250 - 90 * t), int(170 - 90 * t), int(90 + 70 * t)))
    d.ellipse([350, 120, 450, 220], fill=(255, 210, 120))
    x = 20
    while x < W:                                                            # skyline silhouettes
        w = rng.randint(40, 80)
        h = rng.randint(50, 170) if not 300 < x < 480 else rng.randint(30, 90)
        d.rectangle([x, 330 - h, x + w, 330], fill=(45, 40, 70))
        x += w + rng.randint(4, 14)
    d.rectangle([0, 330, W, 400], fill=(70, 100, 150))                      # lake
    for y in range(340, 400, 12):
        d.line([(rng.randint(0, 300), y), (rng.randint(400, 800), y)], fill=(230, 160, 110), width=2)
    d.rectangle([0, 400, W, SCENE_H], fill=(150, 150, 145))                 # path
    d.rectangle([250, 380, 560, 395], fill=(120, 80, 50))                   # empty bench: back
    d.rectangle([250, 420, 560, 432], fill=(120, 80, 50))                   # seat
    for lx in (270, 530):
        d.rectangle([lx, 395, lx + 10, 470], fill=(60, 60, 60))


def scene_sink_leak(d, rng):
    d.rectangle([0, 0, W, SCENE_H], fill=(110, 80, 55))                     # cabinet inside
    d.rectangle([0, 0, W, 40], fill=(225, 225, 220))                        # sink bottom
    d.rectangle([20, 40, 780, SCENE_H], outline=(80, 55, 35), width=8)
    d.line([(400, 40), (400, 170)], fill=(170, 170, 175), width=26)         # drain pipe
    d.line([(400, 170), (400, 230), (520, 230), (520, 120)], fill=(170, 170, 175), width=26, joint='curve')
    d.rectangle([382, 160, 418, 182], fill=(130, 130, 135))                 # the joint
    for k, y in enumerate((205, 255, 305, 350)):                            # drips
        d.ellipse([393, y, 407, y + 20], fill=(90, 160, 230))
    d.polygon([(330, 380), (470, 380), (450, 490), (350, 490)], fill=(60, 120, 200), outline=(40, 80, 150))   # bucket
    d.arc([330, 330, 470, 430], 180, 360, fill=(40, 80, 150), width=4)
    d.ellipse([338, 372, 462, 392], fill=(120, 180, 240))
    for x, c in ((80, (230, 80, 80)), (130, (240, 220, 80)), (650, (90, 190, 120)), (700, (230, 230, 240))):   # bottles pushed aside
        d.rounded_rectangle([x, 330, x + 40, 480], radius=10, fill=c, outline=(60, 60, 60))
        d.rectangle([x + 12, 310, x + 28, 330], fill=(60, 60, 60))


def scene_puppy(d, rng):
    _sky_grass(d, horizon=220)
    d.rectangle([520, 40, 530, 230], fill=(120, 90, 60))                    # event sign
    d.rectangle([420, 40, 760, 110], fill=(255, 255, 255), outline=(200, 80, 60), width=4)
    d.text((590, 75), 'ADOPTION DAY', font=_font(30), fill=(200, 80, 60), anchor='mm')
    d.polygon([(120, 330), (680, 330), (740, 480), (60, 480)], fill=(190, 50, 50))   # blanket
    for k in range(0, 700, 60):
        d.line([(60 + k, 480), (120 + k * 0.8, 330)], fill=(240, 220, 200), width=4)
    d.ellipse([300, 300, 500, 440], fill=(250, 248, 240))                   # body (white)
    d.ellipse([340, 300, 470, 370], fill=(40, 30, 25))                      # black saddle
    d.ellipse([310, 200, 430, 320], fill=(190, 120, 60))                    # head (tan)
    d.ellipse([345, 260, 400, 315], fill=(250, 248, 240))                   # white muzzle
    d.ellipse([360, 262, 382, 278], fill=(30, 20, 20))                      # nose
    d.ellipse([285, 215, 330, 300], fill=(130, 75, 35))                     # floppy ears
    d.ellipse([410, 215, 455, 300], fill=(130, 75, 35))
    d.ellipse([340, 235, 352, 247], fill=(30, 20, 20))
    d.ellipse([385, 235, 397, 247], fill=(30, 20, 20))
    d.rectangle([330, 318, 420, 330], fill=(40, 120, 200))                  # collar
    d.rectangle([365, 330, 390, 360], fill=(255, 255, 240), outline=(120, 120, 120))   # paper tag
    d.ellipse([480, 360, 520, 380], fill=(250, 248, 240))                   # tail


def scene_cat_window(d, rng):
    d.rectangle([0, 0, W, SCENE_H], fill=(214, 206, 190))                   # wall
    d.rectangle([140, 30, 660, 330], fill=(255, 238, 170))                  # sunny window
    d.rectangle([140, 30, 660, 330], outline=(250, 250, 250), width=14)
    d.line([(400, 30), (400, 330)], fill=(250, 250, 250), width=10)
    d.polygon([(160, 340), (660, 340), (760, 500), (260, 500)], fill=(255, 245, 200))   # sunlight on the wall
    d.rectangle([100, 330, 700, 360], fill=(250, 250, 250), outline=(200, 200, 200))     # windowsill
    d.ellipse([220, 250, 480, 345], fill=(140, 140, 145))                   # curled gray body
    for x in range(250, 460, 30):
        d.arc([x, 255, x + 40, 340], 200, 340, fill=(95, 95, 100), width=5)  # tabby stripes
    d.ellipse([430, 245, 520, 330], fill=(150, 150, 155))                   # head
    d.polygon([(440, 260), (455, 225), (470, 258)], fill=(150, 150, 155))
    d.polygon([(480, 258), (497, 225), (510, 262)], fill=(150, 150, 155))
    d.arc([448, 280, 470, 295], 0, 180, fill=(50, 50, 50), width=3)         # closed eyes
    d.arc([480, 280, 502, 295], 0, 180, fill=(50, 50, 50), width=3)
    d.arc([180, 290, 260, 350], 90, 270, fill=(140, 140, 145), width=14)    # tail
    d.polygon([(560, 260), (640, 260), (628, 330), (572, 330)], fill=(196, 104, 60))     # pot
    for ox, oy in ((600, 210), (575, 225), (625, 225), (590, 190), (612, 192)):
        d.ellipse([ox - 22, oy - 12, ox + 22, oy + 12], fill=(70, 150, 80))


def scene_chili_bowl(d, rng):
    d.rectangle([0, 0, W, SCENE_H], fill=(150, 100, 60))                    # wooden table
    for y in range(20, SCENE_H, 46):
        d.arc([-200, y, 1000, y + 60], 190, 350, fill=(125, 80, 45), width=3)
    d.ellipse([200, 140, 600, 420], fill=(245, 245, 240), outline=(200, 200, 195), width=4)   # bowl
    d.ellipse([235, 170, 565, 380], fill=(140, 40, 25))                     # chili
    for _ in range(60):                                                     # shredded cheddar
        x, y = rng.randint(280, 520), rng.randint(200, 350)
        a = rng.uniform(0, math.pi)
        d.line([(x, y), (x + 18 * math.cos(a), y + 18 * math.sin(a))], fill=(250, 170, 40), width=4)
    for _ in range(25):                                                     # green onions
        x, y = rng.randint(290, 510), rng.randint(210, 340)
        d.ellipse([x, y, x + 10, y + 10], outline=(80, 180, 70), width=3)
    d.line([(600, 300), (740, 420)], fill=(190, 190, 195), width=14)        # spoon
    d.ellipse([570, 270, 625, 320], fill=(190, 190, 195))


def scene_bicycle(d, rng):
    d.rectangle([0, 0, W, 280], fill=(200, 205, 210))                       # building wall
    d.rectangle([0, 280, W, SCENE_H], fill=(160, 160, 160))                 # sidewalk
    for x in range(0, W, 120):
        d.line([(x, 280), (x - 60, SCENE_H)], fill=(130, 130, 130), width=2)
    for _ in range(140):                                                    # autumn leaves
        x, y = rng.randint(0, W), rng.randint(290, SCENE_H)
        c = rng.choice([(220, 110, 30), (200, 60, 40), (235, 180, 40), (170, 80, 30)])
        d.ellipse([x, y, x + rng.randint(10, 18), y + rng.randint(6, 11)], fill=c)
    d.rectangle([580, 40, 600, 470], fill=(40, 70, 50))                     # lamp post
    d.polygon([(560, 40), (620, 40), (605, 15), (575, 15)], fill=(40, 70, 50))
    d.ellipse([572, 40, 608, 70], fill=(255, 235, 150))
    red = (210, 30, 40)
    for cx in (230, 470):                                                   # wheels
        d.ellipse([cx - 85, 300, cx + 85, 470], outline=(30, 30, 30), width=10)
        for k in range(8):
            a = k * math.pi / 4
            d.line([(cx, 385), (cx + 80 * math.cos(a), 385 + 80 * math.sin(a))], fill=(120, 120, 120), width=2)
    d.line([(230, 385), (330, 290), (470, 385), (360, 385), (230, 385)], fill=red, width=10, joint='curve')   # frame
    d.line([(360, 385), (330, 290)], fill=red, width=10)
    d.line([(330, 290), (320, 255)], fill=red, width=8)
    d.rounded_rectangle([295, 245, 345, 260], radius=6, fill=(30, 30, 30))   # seat
    d.line([(470, 385), (450, 260)], fill=red, width=10)
    d.line([(430, 255), (490, 250)], fill=(30, 30, 30), width=8)             # handlebar
    d.arc([520, 300, 610, 380], 90, 270, fill=(240, 200, 40), width=10)      # U-lock to the post
    d.line([(470, 350), (565, 340)], fill=(240, 200, 40), width=8)


SCENES = {
    'hotdog_person': scene_hotdog_person, 'hotdog_table': scene_hotdog_table, 'moving_boxes': scene_moving_boxes,
    'birthday_cake': scene_birthday_cake, 'skyline': scene_skyline, 'sink_leak': scene_sink_leak,
    'puppy': scene_puppy, 'cat_window': scene_cat_window, 'chili_bowl': scene_chili_bowl, 'bicycle': scene_bicycle,
}


def _wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        trial = (cur + ' ' + w).strip()
        if d.textlength(trial, font=font) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_placeholder(scene: str, caption: str, seed: int) -> Image.Image:
    im = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(im)
    SCENES[scene](d, random.Random(seed))
    d.rectangle([0, SCENE_H, W, H], fill=(250, 249, 245))
    d.line([(0, SCENE_H), (W, SCENE_H)], fill=(190, 190, 185), width=2)
    f = _font(20)
    lines = _wrap(d, caption, f, W - 48)
    y = SCENE_H + (H - SCENE_H - 26 * len(lines)) / 2
    for line in lines:
        d.text((24, y), line, font=f, fill=(40, 40, 40))
        y += 26
    tag = _font(15)
    label = 'PLACEHOLDER: replace with a free-to-use photo'
    tw = d.textlength(label, font=tag)
    d.rounded_rectangle([12, 12, 12 + tw + 20, 40], radius=7, fill=(255, 255, 255), outline=(180, 120, 40), width=2)
    d.text((22, 17), label, font=tag, fill=(140, 80, 10))
    return im

# ---------------------------------------------------------------- metadata

def _dms(value: float):
    v = abs(value)
    deg = int(v)
    minutes_full = (v - deg) * 60
    minutes = int(minutes_full)
    seconds = round((minutes_full - minutes) * 60, 2)
    return (IFDRational(deg, 1), IFDRational(minutes, 1), IFDRational(int(round(seconds * 100)), 100))


def exif_bytes(entry: dict) -> bytes:
    local = entry['date'][:19].replace('-', ':', 2).replace('T', ' ')
    ex = Image.Exif()
    ex[0x010F] = 'Sieve Playground'           # Make
    ex[0x0131] = 'sieve-playground-build'     # Software
    ex.get_ifd(0x8769)[0x9003] = local        # DateTimeOriginal
    if entry['hadGps']:
        gps = ex.get_ifd(0x8825)
        lat, lon = entry['gps']['lat'], entry['gps']['lon']
        gps[1] = 'N' if lat >= 0 else 'S'
        gps[2] = _dms(lat)
        gps[3] = 'E' if lon >= 0 else 'W'
        gps[4] = _dms(lon)
    return ex.tobytes()


def xmp_segment(city: str) -> bytes:
    packet = ('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
              '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
              '<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" '
              f'photoshop:City="{city}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>').encode('utf-8')
    payload = b'http://ns.adobe.com/xap/1.0/\x00' + packet
    return b'\xff\xe1' + (len(payload) + 2).to_bytes(2, 'big') + payload


def _encode(im: Image.Image, entry: dict, quality: int) -> bytes:
    buf = io.BytesIO()
    if entry['file'].lower().endswith('.png'):
        im.save(buf, 'PNG', optimize=True)
        return buf.getvalue()
    im.convert('RGB').save(buf, 'JPEG', quality=quality, optimize=True, exif=exif_bytes(entry))
    data = buf.getvalue()
    if entry.get('place'):
        data = data[:2] + xmp_segment(entry['place']) + data[2:]   # after SOI
    return data


def find_original(originals_dir: Path, entry: dict) -> Path | None:
    stem = Path(entry['file']).stem
    if not originals_dir.is_dir():
        return None
    for p in sorted(originals_dir.iterdir()):
        if p.stem == stem and p.suffix.lower() in IMAGE_EXTS:
            return p
    return None


def build_photo(entry: dict, caption: str, originals_dir: Path, seed: int) -> tuple[bytes, bytes, dict]:
    """Returns (photo bytes, thumbnail bytes, info) for one photos.json entry."""
    src = find_original(originals_dir, entry)
    if src:
        im = ImageOps.exif_transpose(Image.open(src))
        im.load()
        if not entry['file'].lower().endswith('.png') and im.mode != 'RGB':
            im = im.convert('RGB')
        im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
        im = Image.frombytes(im.mode, im.size, im.tobytes())      # drop every original metadata field
        quality = 85
        data = _encode(im, entry, quality)
        while len(data) > MAX_BYTES and quality > 50 and not entry['file'].lower().endswith('.png'):
            quality -= 5
            data = _encode(im, entry, quality)
        if len(data) > MAX_BYTES:
            raise ValueError(f'{entry["file"]}: still over {MAX_BYTES} bytes; use a smaller original or a JPEG')
        placeholder = False
    else:
        im = draw_placeholder(entry['scene'], caption, seed)
        data = _encode(im, entry, 85)
        if len(data) > PLACEHOLDER_MAX_BYTES:
            raise ValueError(f'{entry["file"]}: placeholder is over {PLACEHOLDER_MAX_BYTES} bytes')
        placeholder = True
    thumb = im.convert('RGB')
    thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
    tb = io.BytesIO()
    thumb.save(tb, 'JPEG', quality=80, optimize=True)
    info = {'width': im.size[0], 'height': im.size[1],
            'mime': 'image/png' if entry['file'].lower().endswith('.png') else 'image/jpeg',
            'placeholder': placeholder, 'original': src.name if src else None}
    return data, tb.getvalue(), info
