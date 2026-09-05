"""
Маска водной поверхности для плейсхолдер-сцены.

Пока сцена не разрезана на слои, шейдер воды надо чем-то ограничить —
иначе рябь пойдёт по кронам деревьев и по столу. Скрипт строит маску
из двух источников:

  1) грубый полигон области пруда (задан руками ниже);
  2) цветовой отсев внутри полигона — растительность (зелёный канал
     доминирует) и дерево стола (тёплый тёмный) выбрасываются.

Дальше morphological cleanup и растушёвка. Результат — одноканальная
маска в альфе + preview с красной заливкой для глазной проверки.

Когда появятся настоящие слои, этот скрипт не нужен: маской станет
альфа слоя 04-water.png.

Запуск:  python tools/make_water_mask.py
"""
from __future__ import annotations

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "assets", "scene", "pond", "_placeholder-full.png")
OUT_MASK = os.path.join(ROOT, "public", "assets", "scene", "pond", "_placeholder-water-mask.png")
OUT_PREVIEW = os.path.join(ROOT, "art", "scene", "pond", "_water-mask-preview.png")

# Грубая область пруда в нормализованных координатах (0..1), по часовой стрелке.
POND_POLY = [
    (0.035, 0.455), (0.300, 0.408), (0.700, 0.400), (0.860, 0.408),
    (0.895, 0.505), (0.880, 0.600), (0.900, 0.675), (0.845, 0.755),
    (0.740, 0.795), (0.560, 0.865), (0.430, 0.925), (0.360, 0.970),
    (0.330, 0.955), (0.300, 0.860), (0.265, 0.760), (0.190, 0.660),
    (0.120, 0.560), (0.060, 0.500),
]


def polygon_mask(w: int, h: int) -> np.ndarray:
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).polygon([(x * w, y * h) for x, y in POND_POLY], fill=255)
    return np.asarray(img, dtype=np.float32) / 255.0


def water_score(rgb: np.ndarray) -> np.ndarray:
    """
    Вода в этой сцене — холодная и малонасыщенная: B >= G, зелёный не
    доминирует. Растительность даёт заметный перевес G над B, дерево
    стола — перевес R. Оба случая отсекаем.
    """
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    veg = np.clip((g - b) / 0.10, 0.0, 1.0)          # 1 = уверенно листва
    wood = np.clip((r - b) / 0.10, 0.0, 1.0)         # 1 = уверенно дерево
    dark = np.clip((0.20 - rgb.max(axis=-1)) / 0.12, 0.0, 1.0)  # тени и силуэт котика

    return np.clip(1.0 - np.maximum(np.maximum(veg, wood), dark), 0.0, 1.0)


def cleanup(mask: np.ndarray, open_px: int = 5, close_px: int = 9,
            feather_px: float = 14.0) -> np.ndarray:
    """Морфология на PIL: MinFilter = erode, MaxFilter = dilate."""
    img = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
    img = img.filter(ImageFilter.MinFilter(open_px))    # выкусить крапинки
    img = img.filter(ImageFilter.MaxFilter(open_px))
    img = img.filter(ImageFilter.MaxFilter(close_px))   # залить дырки
    img = img.filter(ImageFilter.MinFilter(close_px))
    img = img.filter(ImageFilter.GaussianBlur(feather_px))
    return np.asarray(img, dtype=np.float32) / 255.0


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    rgb = np.asarray(src, dtype=np.float32) / 255.0

    mask = polygon_mask(w, h) * water_score(rgb)
    mask = cleanup(mask)

    # Затухание к горизонту: у дальнего берега рябь должна сходить на нет,
    # иначе перспектива ломается — вдали волны физически мельче пикселя.
    yy = np.linspace(0.0, 1.0, h)[:, None]
    horizon = np.clip((yy - 0.425) / 0.16, 0.0, 1.0) ** 0.8
    mask = mask * horizon

    white = np.ones((h, w, 3), dtype=np.float32)
    out = np.concatenate([white, mask[..., None]], axis=-1)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT_MASK, optimize=True)

    tint = rgb.copy()
    tint[..., 0] = np.clip(tint[..., 0] + mask * 0.55, 0, 1)
    tint[..., 1] *= 1.0 - mask * 0.45
    tint[..., 2] *= 1.0 - mask * 0.45
    Image.fromarray((tint * 255 + 0.5).astype(np.uint8), "RGB").save(OUT_PREVIEW)

    print(f"маска   -> {os.path.relpath(OUT_MASK, ROOT)}  ({os.path.getsize(OUT_MASK)/1024:.1f} КБ)")
    print(f"preview -> {os.path.relpath(OUT_PREVIEW, ROOT)}")
    print(f"покрытие: {mask.mean()*100:.1f}% кадра")


if __name__ == "__main__":
    main()
