from __future__ import annotations

import math
import os
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "shared-assets"
IMAGES = ASSETS / "images"
AUDIO = ASSETS / "audio"

W, H = 1920, 1080


@dataclass(frozen=True)
class Chapter:
    filename: str
    title: str
    era: str
    caption: str
    sky: tuple[int, int, int]
    ground: tuple[int, int, int]
    accent: tuple[int, int, int]
    body_scale: float
    tool: str
    posture: float


CHAPTERS = [
    Chapter(
        "01_early_hominins.png",
        "Early Hominins",
        "7-4 million years ago",
        "Upright walking begins to reshape life on open woodland edges.",
        (213, 184, 145),
        (99, 91, 62),
        (178, 111, 64),
        0.78,
        "branch",
        -0.12,
    ),
    Chapter(
        "02_australopithecus.png",
        "Australopithecus",
        "4-2 million years ago",
        "Hands, feet, and balance adapt to both trees and ground.",
        (221, 190, 153),
        (113, 96, 65),
        (196, 132, 72),
        0.86,
        "stone",
        -0.06,
    ),
    Chapter(
        "03_homo_habilis.png",
        "Homo habilis",
        "2.4-1.5 million years ago",
        "Stone tools extend memory, skill, and shared survival.",
        (210, 177, 139),
        (105, 88, 63),
        (183, 143, 91),
        0.95,
        "flake",
        0.02,
    ),
    Chapter(
        "04_homo_erectus.png",
        "Homo erectus",
        "1.9 million-110,000 years ago",
        "Long-distance walking and fire open new landscapes.",
        (196, 165, 134),
        (93, 80, 65),
        (218, 118, 61),
        1.05,
        "fire",
        0.09,
    ),
    Chapter(
        "05_early_sapiens.png",
        "Early Homo sapiens",
        "300,000-40,000 years ago",
        "Symbol, language, and craft deepen social worlds.",
        (185, 167, 151),
        (87, 78, 68),
        (127, 153, 135),
        1.1,
        "spear",
        0.13,
    ),
    Chapter(
        "06_modern_humans.png",
        "Modern Humans",
        "Today",
        "Culture, science, and care become part of our evolutionary story.",
        (177, 186, 184),
        (77, 86, 79),
        (91, 139, 151),
        1.12,
        "constellation",
        0.16,
    ),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/georgia.ttf",
        "C:/Windows/Fonts/georgiab.ttf" if bold else "C:/Windows/Fonts/georgia.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for item in candidates:
        if item and os.path.exists(item):
            return ImageFont.truetype(item, size=size)
    return ImageFont.load_default()


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def gradient(bg: tuple[int, int, int], ground: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGB", (W, H))
    px = img.load()
    top = tuple(max(0, c - 46) for c in bg)
    horizon = tuple(min(255, c + 38) for c in bg)
    for y in range(H):
        t = y / H
        if t < 0.62:
            k = t / 0.62
            col = tuple(lerp(top[i], horizon[i], k) for i in range(3))
        else:
            k = (t - 0.62) / 0.38
            col = tuple(lerp(horizon[i], ground[i], min(1, k * 1.2)) for i in range(3))
        for x in range(W):
            px[x, y] = col
    return img


def draw_landscape(draw: ImageDraw.ImageDraw, chapter: Chapter, idx: int) -> None:
    rng = np.random.default_rng(420 + idx)
    sun = (W - 330 - idx * 90, 210 + idx * 18)
    draw.ellipse((sun[0] - 90, sun[1] - 90, sun[0] + 90, sun[1] + 90), fill=chapter.accent + (90,))
    for i in range(3):
        y = 600 + i * 72
        points = []
        for x in range(-100, W + 120, 120):
            yy = y + math.sin((x * 0.006) + idx + i) * (38 + i * 10)
            points.append((x, yy))
        points.extend([(W + 100, H), (-100, H)])
        shade = tuple(max(0, c - 18 * i) for c in chapter.ground)
        draw.polygon(points, fill=shade)
    for _ in range(60):
        x = int(rng.integers(0, W))
        y = int(rng.integers(670, H))
        length = int(rng.integers(8, 24))
        col = tuple(min(255, c + int(rng.integers(5, 30))) for c in chapter.ground)
        draw.line((x, y, x + length, y - int(length * 0.35)), fill=col, width=2)


def draw_human(draw: ImageDraw.ImageDraw, cx: int, base: int, chapter: Chapter) -> None:
    s = chapter.body_scale
    skin = (89, 65, 49)
    cloth = tuple(max(0, c - 18) for c in chapter.accent)
    torso_top = base - int(330 * s)
    head_r = int(48 * s)
    lean = int(48 * chapter.posture)
    head = (cx + lean, torso_top - int(75 * s))
    hip = (cx, base - int(165 * s))
    shoulder = (cx + lean // 2, torso_top)
    draw.line((shoulder[0], shoulder[1], hip[0], hip[1]), fill=skin, width=int(30 * s))
    draw.ellipse((head[0] - head_r, head[1] - head_r, head[0] + head_r, head[1] + head_r), fill=skin)
    draw.line((shoulder[0] - int(18 * s), shoulder[1] + int(15 * s), cx - int(112 * s), base - int(218 * s)), fill=skin, width=int(20 * s))
    draw.line((shoulder[0] + int(24 * s), shoulder[1] + int(12 * s), cx + int(118 * s), base - int(222 * s)), fill=skin, width=int(20 * s))
    draw.line((hip[0] - int(8 * s), hip[1], cx - int(92 * s), base), fill=skin, width=int(24 * s))
    draw.line((hip[0] + int(14 * s), hip[1], cx + int(92 * s), base - int(8 * s)), fill=skin, width=int(24 * s))
    draw.polygon(
        [
            (shoulder[0] - int(44 * s), shoulder[1] + int(20 * s)),
            (shoulder[0] + int(68 * s), shoulder[1] + int(6 * s)),
            (hip[0] + int(50 * s), hip[1] + int(12 * s)),
            (hip[0] - int(42 * s), hip[1] + int(5 * s)),
        ],
        fill=cloth,
    )
    draw.ellipse((head[0] - int(28 * s), head[1] - int(6 * s), head[0] - int(18 * s), head[1] + int(4 * s)), fill=(28, 25, 21))


def draw_tool(draw: ImageDraw.ImageDraw, chapter: Chapter, x: int, y: int) -> None:
    a = chapter.accent
    if chapter.tool == "branch":
        draw.line((x, y, x + 210, y - 145), fill=(70, 54, 38), width=14)
        draw.line((x + 145, y - 98, x + 200, y - 120), fill=(70, 54, 38), width=7)
    elif chapter.tool == "stone":
        draw.polygon([(x, y), (x + 92, y - 42), (x + 148, y + 14), (x + 70, y + 62)], fill=(104, 99, 91))
        draw.line((x + 20, y + 8, x + 110, y - 16), fill=(172, 166, 151), width=4)
    elif chapter.tool == "flake":
        for i in range(4):
            draw.polygon([(x + i * 44, y), (x + 34 + i * 44, y - 72), (x + 70 + i * 44, y + 5)], fill=(116, 110, 97))
    elif chapter.tool == "fire":
        draw.polygon([(x + 55, y), (x + 92, y - 150), (x + 132, y)], fill=(221, 111, 50))
        draw.polygon([(x + 76, y), (x + 112, y - 98), (x + 146, y)], fill=(245, 183, 83))
        draw.line((x, y + 14, x + 190, y + 14), fill=(56, 40, 31), width=12)
    elif chapter.tool == "spear":
        draw.line((x, y, x + 290, y - 170), fill=(71, 55, 40), width=9)
        draw.polygon([(x + 280, y - 165), (x + 340, y - 204), (x + 314, y - 137)], fill=(126, 126, 116))
    else:
        for i in range(9):
            px = x + int(math.cos(i * 1.7) * 120) + 150
            py = y + int(math.sin(i * 1.2) * 80) - 80
            draw.ellipse((px - 7, py - 7, px + 7, py + 7), fill=a)
            if i:
                draw.line((prev[0], prev[1], px, py), fill=a + (120,), width=3)
            prev = (px, py)


def draw_text(draw: ImageDraw.ImageDraw, chapter: Chapter) -> None:
    draw.text((110, 104), chapter.era.upper(), font=font(32), fill=(49, 45, 39))
    draw.text((110, 154), chapter.title, font=font(88, True), fill=(37, 33, 29))
    draw.rounded_rectangle((110, 844, 1010, 970), radius=26, fill=(246, 232, 207, 190), outline=chapter.accent, width=3)
    draw.text((148, 874), chapter.caption, font=font(33), fill=(44, 40, 35))


def make_chapter(chapter: Chapter, idx: int) -> Image.Image:
    base = gradient(chapter.sky, chapter.ground).convert("RGBA")
    decor = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(decor, "RGBA")
    draw_landscape(d, chapter, idx)
    for offset, alpha in [(0, 80), (16, 50), (-16, 35)]:
        draw_human(d, 1270 + offset + idx * 8, 830, chapter)
    draw_tool(d, chapter, 1320, 765)
    draw_text(d, chapter)
    grain = Image.effect_noise((W, H), 14).convert("L")
    grain_rgba = Image.new("RGBA", (W, H), (255, 244, 224, 18))
    grain_rgba.putalpha(grain.point(lambda p: min(34, max(0, p - 110))))
    base.alpha_composite(decor)
    base.alpha_composite(grain_rgba)
    return base.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1, percent=115, threshold=3))


def write_audio(path: Path, seconds: int = 36, sample_rate: int = 44100) -> None:
    t = np.linspace(0, seconds, seconds * sample_rate, endpoint=False)
    freqs = [196.0, 246.94, 293.66, 392.0]
    audio = np.zeros_like(t)
    for i, freq in enumerate(freqs):
        phase = i * math.pi / 5
        env = 0.5 + 0.5 * np.sin(2 * math.pi * (0.025 + i * 0.006) * t + phase)
        audio += 0.16 * env * np.sin(2 * math.pi * freq * t + phase)
        audio += 0.05 * np.sin(2 * math.pi * freq * 2 * t + phase)
    shimmer = 0.025 * np.sin(2 * math.pi * 783.99 * t) * (0.5 + 0.5 * np.sin(2 * math.pi * 0.04 * t))
    audio += shimmer
    fade_len = sample_rate * 3
    fade = np.ones_like(audio)
    fade[:fade_len] = np.linspace(0, 1, fade_len)
    fade[-fade_len:] = np.linspace(1, 0, fade_len)
    audio *= fade
    audio = np.int16(audio / np.max(np.abs(audio)) * 22000)
    with wave.open(str(path), "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(audio.tobytes())


def make_gif(images: list[Image.Image], path: Path) -> None:
    frames = []
    for img in images:
        small = img.resize((960, 540), Image.Resampling.LANCZOS)
        for i in range(12):
            crop_pad = 26 - i
            frame = small.crop((crop_pad, crop_pad // 2, 960 - crop_pad, 540 - crop_pad // 2)).resize((960, 540))
            frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE))
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=83, loop=0)


def main() -> None:
    IMAGES.mkdir(parents=True, exist_ok=True)
    AUDIO.mkdir(parents=True, exist_ok=True)
    rendered = []
    for idx, chapter in enumerate(CHAPTERS):
        img = make_chapter(chapter, idx)
        img.save(IMAGES / chapter.filename, quality=94)
        rendered.append(img)
    write_audio(AUDIO / "soothing-evolution.wav")
    make_gif(rendered, ASSETS / "evolution-preview.gif")


if __name__ == "__main__":
    main()
