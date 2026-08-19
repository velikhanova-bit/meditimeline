#!/usr/bin/env python3
"""
iOS App Icon Generator
Usage: python3 generate_icon.py "<bg_hex>" "<accent_hex>" "<symbol>" "<output_path>"

symbol options: moon, star, leaf, heart, flame, drop, bolt, eye

Example:
  python3 generate_icon.py "#0f0f1a" "#c9a84c" "moon" "./AppIcon.png"
"""
import sys
import math
import random

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("Install Pillow: pip3 install pillow")
    sys.exit(1)


def hex_to_rgb(hex_color: str) -> tuple:
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def draw_gradient_bg(img: Image.Image, bg_rgb: tuple) -> None:
    SIZE = img.size[0]
    draw = ImageDraw.Draw(img)
    for y in range(SIZE):
        for x in range(SIZE):
            dx = x - SIZE / 2
            dy = y - SIZE / 2
            dist = math.sqrt(dx * dx + dy * dy) / (SIZE / 2)
            r = int(bg_rgb[0] + max(0, (1 - dist) * 15))
            g = int(bg_rgb[1] + max(0, (1 - dist) * 8))
            b = int(bg_rgb[2] + max(0, (1 - dist) * 25))
            img.putpixel((x, y), (min(r, 255), min(g, 255), min(b, 255), 255))


def draw_moon(img: Image.Image, accent_rgb: tuple) -> None:
    SIZE = img.size[0]
    cx, cy = SIZE // 2, SIZE // 2 - SIZE // 32
    moon_r = SIZE // 5
    cut_cx = cx + int(moon_r * 0.6)
    cut_cy = cy - int(moon_r * 0.1)
    cut_r = int(moon_r * 0.85)

    for y in range(SIZE):
        for x in range(SIZE):
            dx, dy = x - cx, y - cy
            d = math.sqrt(dx * dx + dy * dy)
            if d <= moon_r:
                factor = 1 - (d / moon_r) * 0.25
                r = int(accent_rgb[0] * factor)
                g = int(accent_rgb[1] * factor)
                b = int(accent_rgb[2] * factor)
                img.putpixel((x, y), (r, g, b, 255))

    bg_rgb = img.getpixel((0, 0))[:3]
    for y in range(SIZE):
        for x in range(SIZE):
            dx2, dy2 = x - cut_cx, y - cut_cy
            if math.sqrt(dx2 * dx2 + dy2 * dy2) <= cut_r:
                mx, my = x - cx, y - cy
                if math.sqrt(mx * mx + my * my) <= moon_r:
                    ddx, ddy = x - SIZE // 2, y - SIZE // 2
                    dist = math.sqrt(ddx * ddx + ddy * ddy) / (SIZE / 2)
                    r = int(bg_rgb[0] + max(0, (1 - dist) * 15))
                    g = int(bg_rgb[1] + max(0, (1 - dist) * 8))
                    b = int(bg_rgb[2] + max(0, (1 - dist) * 25))
                    img.putpixel((x, y), (min(r, 255), min(g, 255), min(b, 255), 255))

    # glow
    glow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    for y in range(SIZE):
        for x in range(SIZE):
            dx, dy = x - cx, y - cy
            d_moon = math.sqrt(dx * dx + dy * dy)
            dx2, dy2 = x - cut_cx, y - cut_cy
            d_cut = math.sqrt(dx2 * dx2 + dy2 * dy2)
            if moon_r < d_moon <= moon_r + 50 and d_cut > cut_r:
                alpha = int((1 - (d_moon - moon_r) / 50) * 50)
                glow.putpixel((x, y), (*accent_rgb, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=12))
    img.paste(Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB'))


def draw_star_symbol(img: Image.Image, accent_rgb: tuple) -> None:
    SIZE = img.size[0]
    draw = ImageDraw.Draw(img)
    cx, cy = SIZE // 2, SIZE // 2
    outer_r = SIZE // 4
    inner_r = outer_r // 2
    points = []
    for i in range(10):
        angle = math.pi / 5 * i - math.pi / 2
        r = outer_r if i % 2 == 0 else inner_r
        points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(points, fill=accent_rgb + (255,))


def draw_stars(img: Image.Image, accent_rgb: tuple, seed: int = 42) -> None:
    SIZE = img.size[0]
    draw = ImageDraw.Draw(img)
    rng = random.Random(seed)
    cx, cy = SIZE // 2, SIZE // 2
    exclusion_r = SIZE // 3

    for _ in range(80):
        sx = rng.randint(30, SIZE - 30)
        sy = rng.randint(30, SIZE - 30)
        if math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2) < exclusion_r:
            continue
        brightness = rng.uniform(0.2, 0.9)
        size = rng.uniform(1.5, 4.0)
        color = tuple(int(c * brightness) for c in accent_rgb) + (int(200 * brightness),)
        draw.ellipse([sx - size, sy - size, sx + size, sy + size], fill=color)

    for _ in range(10):
        sx = rng.randint(80, SIZE - 80)
        sy = rng.randint(80, SIZE - 80)
        if math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2) < exclusion_r + 50:
            continue
        brightness = rng.uniform(0.4, 1.0)
        length = rng.randint(8, 16)
        color = tuple(int(c * brightness) for c in accent_rgb)
        for i in range(-length, length + 1):
            alpha = max(0, int(200 * brightness * (1 - abs(i) / length)))
            c = color + (alpha,)
            if 0 <= sx + i < SIZE:
                draw.point((sx + i, sy), fill=c)
            if 0 <= sy + i < SIZE:
                draw.point((sx, sy + i), fill=c)


def main():
    args = sys.argv[1:]
    bg_hex = args[0] if len(args) > 0 else "#0f0f1a"
    accent_hex = args[1] if len(args) > 1 else "#c9a84c"
    symbol = args[2] if len(args) > 2 else "moon"
    output = args[3] if len(args) > 3 else "AppIcon.png"

    SIZE = 1024
    bg_rgb = hex_to_rgb(bg_hex)
    accent_rgb = hex_to_rgb(accent_hex)

    img = Image.new('RGBA', (SIZE, SIZE), (*bg_rgb, 255))
    draw_gradient_bg(img, bg_rgb)

    if symbol == "moon":
        draw_moon(img, accent_rgb)
    elif symbol == "star":
        draw_star_symbol(img, accent_rgb)

    draw_stars(img, accent_rgb)

    final = img.convert('RGB')
    final.save(output, 'PNG')
    print(f"Icon saved: {output} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
