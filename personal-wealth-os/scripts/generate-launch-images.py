"""
Launch-screen images for the installed app (PLAN.md S-1 / S-2).

Every launch screen is #141310 with the white W in the middle, 120 CSS px
wide, and on iPhone, iPad and desktop the name "WealthUp" near the bottom
(its baseline box ends 9 % above the bottom edge). Android draws its own
splash from the manifest (background_color + icon) and cannot show a name,
so the page hides the name on Android and all three hand over without a
jump on every platform.

Reads public/brand/launch-name.png (scripts/render-launch-name.mjs, 3x).

Writes:
  public/brand/launch-mark.png   the W on a transparent ground
  public/brand/launch-name.png   trimmed to its ink
  index.html                     both inlined as data URIs in #launch
  public/splash/*.png            one iOS startup image per screen size
  index.html                     the <link rel="apple-touch-startup-image">
                                 block between the LAUNCH-IMAGES markers

Run from personal-wealth-os/:  python scripts/generate-launch-images.py
Needs Pillow. Re-run whenever the icon changes or Apple adds a screen size.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "public/icons/icon-512-maskable.png"
MARK_OUT = ROOT / "public/brand/launch-mark.png"
NAME = ROOT / "public/brand/launch-name.png"
NAME_SCALE = 3  # launch-name.png is drawn at 3x
NAME_BOTTOM = 0.09  # gap under the name, as a share of the screen height
SPLASH_DIR = ROOT / "public/splash"
INDEX = ROOT / "index.html"

GROUND = (20, 19, 16)  # #141310, manifest background_color
MARK_CSS_WIDTH = 120  # must match #launch img in index.html

# Whether to link the startup images from index.html.
#
# Back on 2026-09-23: turning them off did not stop the twitch (it happens
# inside iOS's transition, which a web app cannot opt out of), and it cost
# the logo ~100-150ms of arriving late. Kept as a flag because the reasoning
# is worth keeping. With them, iOS draws the W itself and then cross-
# dissolves to the web view's own copy, and its open-from-the-icon zoom is
# plainly visible because there is a logo in the picture to watch: measured
# off the user's screen recording, the logo grew 16% and rose 21.5px over
# 120ms, then a second W ghosted 20px above it for another 41ms. None of
# that is reachable from a web app - the page cannot opt out of iOS's
# transition. Without the links iOS fills the screen with a flat colour
# instead, and a zoom of a flat colour shows nothing; the W is then drawn
# once, by the page, already in its final place.
#
# The images are still generated, so setting this back to True restores the
# old behaviour. iOS reads the links only when the icon is added to the
# home screen, so either way the icon has to be re-added to see the change.
LINK_STARTUP_IMAGES = True

# (label, CSS width, CSS height, device pixel ratio) in portrait.
IPHONES = [
    ("iPhone 16/17 Pro Max", 440, 956, 3),
    ("iPhone Air", 420, 912, 3),
    ("iPhone 16/17 Pro, 17", 402, 874, 3),
    ("iPhone 14 Pro Max, 15/16 Plus, 15 Pro Max", 430, 932, 3),
    ("iPhone 14 Pro, 15, 15 Pro, 16", 393, 852, 3),
    ("iPhone 12/13 Pro Max, 14 Plus", 428, 926, 3),
    ("iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e", 390, 844, 3),
    ("iPhone X, XS, 11 Pro, 12/13 mini", 375, 812, 3),
    ("iPhone XS Max, 11 Pro Max", 414, 896, 3),
    ("iPhone XR, 11", 414, 896, 2),
    ("iPhone 6/7/8 Plus", 414, 736, 3),
    ("iPhone 6/7/8, SE 2/3", 375, 667, 2),
    ("iPhone SE (1st)", 320, 568, 2),
]
IPADS = [
    ("iPad Pro 13 (M4)", 1032, 1376, 2),
    ("iPad Pro 12.9, Air 13 (M2)", 1024, 1366, 2),
    ("iPad Pro 11 (M4)", 834, 1210, 2),
    ("iPad Pro 11, Air 11 (M2)", 834, 1194, 2),
    ("iPad Air 4/5, iPad 10", 820, 1180, 2),
    ("iPad Pro 10.5, Air 3", 834, 1112, 2),
    ("iPad 7/8/9", 810, 1080, 2),
    ("iPad mini 6/7", 744, 1133, 2),
    ("iPad 5/6, mini 4/5, Air 2", 768, 1024, 2),
]


def transparent_mark() -> Image.Image:
    """The icon's white W with its ground made transparent, cropped tight.

    Coverage is recovered from how far each pixel moved from the ground
    toward white, so the anti-aliased edge survives.
    """
    src = Image.open(ICON).convert("RGB")
    out = Image.new("RGBA", src.size)
    px, po = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b = px[x, y]
            a = ((r - GROUND[0]) / (255 - GROUND[0]) + (g - GROUND[1]) / (255 - GROUND[1]) + (b - GROUND[2]) / (255 - GROUND[2])) / 3
            po[x, y] = (255, 255, 255, round(max(0.0, min(1.0, a)) * 255))
    return out.crop(out.getbbox())


def scaled(mark: Image.Image, width: int) -> Image.Image:
    return mark.resize((width, round(mark.height * width / mark.width)), Image.LANCZOS)


def splash(mark: Image.Image, name: Image.Image, w: int, h: int, dpr: int) -> Image.Image:
    canvas = Image.new("RGB", (w * dpr, h * dpr), GROUND)
    m = scaled(mark, MARK_CSS_WIDTH * dpr)
    canvas.paste(m, ((canvas.width - m.width) // 2, (canvas.height - m.height) // 2), m)
    n = scaled(name, round(name.width * dpr / NAME_SCALE))
    canvas.paste(n, ((canvas.width - n.width) // 2, round(canvas.height * (1 - NAME_BOTTOM)) - n.height), n)
    return canvas


def data_uri(path: Path) -> str:
    import base64
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def main() -> None:
    mark = transparent_mark()
    scaled(mark, MARK_CSS_WIDTH * 2).save(MARK_OUT, optimize=True)
    name = Image.open(NAME).convert("RGBA")
    name = name.crop(name.getbbox())
    name.save(NAME, optimize=True)

    SPLASH_DIR.mkdir(parents=True, exist_ok=True)
    for old in SPLASH_DIR.glob("apple-splash-*.png"):
        old.unlink()

    links = []
    seen = set()
    screens = [(label, w, h, dpr, "portrait") for label, w, h, dpr in IPHONES]
    for label, w, h, dpr in IPADS:
        screens.append((label, w, h, dpr, "portrait"))
        screens.append((label, h, w, dpr, "landscape"))
    for label, w, h, dpr, orientation in screens:
        file = f"apple-splash-{w * dpr}x{h * dpr}.png"
        if file not in seen:
            splash(mark, name, w, h, dpr).save(SPLASH_DIR / file, optimize=True)
            seen.add(file)
        # Media features are in portrait terms: device-width is the short side.
        short, long = min(w, h), max(w, h)
        links.append(
            f'    <link rel="apple-touch-startup-image" href="/splash/{file}" media="screen and (device-width: {short}px) and '
            f'(device-height: {long}px) and (-webkit-device-pixel-ratio: {dpr}) and (orientation: {orientation})" /><!-- {label} -->'
        )

    start, end = "    <!-- LAUNCH-IMAGES:START", "    <!-- LAUNCH-IMAGES:END -->"
    html = INDEX.read_text(encoding="utf-8")
    body = "\n".join(links) if LINK_STARTUP_IMAGES else (
        "         Intentionally empty - see LINK_STARTUP_IMAGES in\n"
        "         scripts/generate-launch-images.py. The images are still\n"
        "         built into public/splash; set it to True to link them. -->\n"
    )
    head = "    <!-- LAUNCH-IMAGES:START (generated by scripts/generate-launch-images.py; do not edit by hand)"
    block = head + ("-->\n" if LINK_STARTUP_IMAGES else "\n") + body + ("\n" if LINK_STARTUP_IMAGES else "") + end
    if start in html:
        html = html[: html.index(start)] + block + html[html.index(end) + len(end):]
    else:
        anchor = '    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />'
        html = html.replace(anchor, anchor + "\n" + block, 1)
    # The page's launch screen shows the same two images, inlined so they
    # paint with the HTML; its CSS sizes the name at 1/NAME_SCALE.
    import re
    for element_id, path in (("launch-mark", MARK_OUT), ("launch-name", NAME)):
        html, count = re.subn(rf'(<img id="{element_id}"[^>]*? src=")data:image/png;base64,[^"]*(")', rf"\g<1>{data_uri(path)}\g<2>", html)
        if count != 1:
            raise SystemExit(f"index.html needs exactly one <img id=\"{element_id}\" ... src=\"data:...\">")
    css_width = f"width: {name.width / NAME_SCALE:g}px;"
    html, count = re.subn(r"(#launch-name \{[^}]*?)width: [0-9.]+px;", rf"\g<1>{css_width}", html)
    if count != 1:
        raise SystemExit("index.html needs one #launch-name rule with a width")
    INDEX.write_text(html, encoding="utf-8")
    print(f"{len(seen)} images, {len(links)} links; name {name.width}x{name.height} px = {name.width / NAME_SCALE:.2f} CSS px wide")


if __name__ == "__main__":
    main()
