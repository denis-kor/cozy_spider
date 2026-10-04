"""
Иконки сайта из art/brand/cozyspider_icon.png (пиксель-арт 768×768:
кот за раскладкой, надпись COZY SPIDER, бежевая рамка со скруглением).

Углы за рамкой в исходнике залиты чёрным, не прозрачные. Для вкладки они
вырезаются: снаружи рамки — всё чёрное, связанное с краем картинки.
apple-touch-icon остаётся непрозрачной — iOS скругляет сильнее рамки
(~22% против ~17%), чёрные углы уходят под маску.

Выход: public/favicon.ico (16/32/48), icon-120.png (размер, который просит
Яндекс), icon-192.png, apple-touch-icon.png (180).

Запуск:  python tools/gen_favicons.py
"""
from __future__ import annotations

import os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "brand", "cozyspider_icon.png")
OUT = os.path.join(ROOT, "public")


def load() -> tuple[Image.Image, Image.Image]:
    """(rgba с прозрачными углами, rgb как есть), обрезанные по рамке."""
    rgb = Image.open(SRC).convert("RGB")
    a = np.asarray(rgb).astype(int)
    dark = a.sum(2) < 40
    labels, _ = ndimage.label(dark)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    outside = np.isin(labels, edge[edge > 0])

    ys, xs = np.where(~outside)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    alpha = Image.fromarray(np.where(outside, 0, 255).astype(np.uint8))
    rgba = rgb.copy()
    rgba.putalpha(alpha)
    return square(rgba.crop(box), (0, 0, 0, 0)), square(rgb.crop(box), (0, 0, 0))


def square(im: Image.Image, fill) -> Image.Image:
    w, h = im.size
    s = max(w, h)
    out = Image.new(im.mode, (s, s), fill)
    out.paste(im, ((s - w) // 2, (s - h) // 2))
    return out


def main() -> None:
    rgba, rgb = load()
    sized = lambda im, s: im.resize((s, s), Image.LANCZOS)

    ico = [sized(rgba, s) for s in (16, 32, 48)]
    ico[2].save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[:2])
    sized(rgba, 120).save(os.path.join(OUT, "icon-120.png"), optimize=True)
    sized(rgba, 192).save(os.path.join(OUT, "icon-192.png"), optimize=True)
    sized(rgb, 180).save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    print("favicon.ico, icon-120.png, icon-192.png, apple-touch-icon.png ->", OUT)


if __name__ == "__main__":
    main()
