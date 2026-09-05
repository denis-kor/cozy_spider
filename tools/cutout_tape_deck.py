"""
Вырезать корпус магнитофона из картинки на белом фоне.

Нужен, когда арт приходит без альфы — например, снимком из чата. Пишет
готовый PNG с прозрачностью и заодно замеряет прямоугольники окна и
клавиш, которые потом идут в манифест сцены.

Запуск:
  python tools/cutout_tape_deck.py вход.jpg [выход.png]
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Фон и тень — светлые и НЕЙТРАЛЬНЫЕ. Корпус либо тёмный, либо цветной.
# Две проверки вместо одной: по яркости фон не отличить от кремовой
# верхней грани, а по цветности — от серой тени.
BG_MIN_LUMA = 115
BG_MAX_CHROMA = 30

# Насколько густой оставить тень под корпусом.
SHADOW_STRENGTH = 0.85
SHADOW_COLOR = (18, 20, 22)


def background_mask(rgb: np.ndarray) -> np.ndarray:
    """
    Заливка от четырёх углов.

    Именно заливка, а не порог по всей картинке: у корпуса тёмная обводка
    по контуру, и связность не пускает заливку внутрь. Порог же выел бы и
    светлые клавиши, и блик на верхней грани.
    """
    luma = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    passable = (luma > BG_MIN_LUMA) & (chroma < BG_MAX_CHROMA)

    labels, _ = ndimage.label(passable)
    h, w = luma.shape
    corners = [labels[0, 0], labels[0, w - 1], labels[h - 1, 0], labels[h - 1, w - 1]]

    mask = np.zeros_like(passable)
    for label in corners:
        if label:
            mask |= labels == label
    return mask


def measure(rgb: np.ndarray, obj: np.ndarray) -> dict:
    """Найти окно кассеты и три клавиши, чтобы не мерить их линейкой."""
    h, w = obj.shape
    luma = rgb.mean(axis=2)

    # Окно — самая крупная тёмная область внутри корпуса.
    dark = obj & (luma < 45)
    labels, count = ndimage.label(dark)
    if count == 0:
        return {}
    sizes = ndimage.sum(dark, labels, range(1, count + 1))
    win_slice = ndimage.find_objects(labels == int(sizes.argmax()) + 1)[0]

    # Клавиши ищутся по МЕСТНОМУ контрасту, а не по абсолютной яркости.
    #
    # Свет падает наискось, и крайняя клавиша попадает в тень от корпуса:
    # по общему порогу она уже «тёмная», хотя на своей панели остаётся
    # светлым пятном. Сравнение с окном 91 px это переживает.
    local = ndimage.uniform_filter(luma, size=91)
    lower = np.zeros_like(obj)
    lower[int(h * 0.55):int(h * 0.92), :] = True

    spots = obj & lower & ((luma - local) > 20)
    labels, count = ndimage.label(spots)

    candidates = []
    if count:
        for slices in ndimage.find_objects(labels):
            bw = slices[1].stop - slices[1].start
            bh = slices[0].stop - slices[0].start
            # Отсев по форме. Самое яркое пятно на этой панели — не клавиша,
            # а блестящая кромка над ними: во всю ширину и в пару пикселей
            # высотой. По площади она выигрывает у любой клавиши.
            if not (w * 0.04 < bw < w * 0.25):
                continue
            if not (h * 0.03 < bh < h * 0.20):
                continue
            candidates.append((bw * bh, slices))

    candidates.sort(key=lambda c: c[0], reverse=True)
    boxes = [c[1] for c in candidates[:3]]
    boxes.sort(key=lambda s: s[1].start)

    def frac(s) -> list[float]:
        return [
            round(s[1].start / w, 3),
            round(s[0].start / h, 3),
            round((s[1].stop - s[1].start) / w, 3),
            round((s[0].stop - s[0].start) / h, 3),
        ]

    return {"window": frac(win_slice), "keys": [frac(b) for b in boxes]}


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else "art/scene/pond/tape-deck.png"

    im = Image.open(src).convert("RGB")
    rgb = np.asarray(im, dtype=np.float32)
    h, w = rgb.shape[:2]
    print(f"вход: {os.path.basename(src)}  {w}x{h}")

    bg = background_mask(rgb)
    obj = ~bg
    print(f"корпус занимает {obj.mean() * 100:.1f}% кадра")

    # Тень восстанавливается из яркости фона: чем темнее было место, тем
    # плотнее тень. Иначе вместе с фоном ушла бы и она, и корпус повис бы
    # в воздухе без опоры.
    luma = rgb.mean(axis=2)
    shadow = np.clip((255.0 - luma) / 255.0, 0, 1) * bg * SHADOW_STRENGTH

    alpha = np.where(obj, 1.0, shadow)
    out = np.where(obj[..., None], rgb, np.array(SHADOW_COLOR, dtype=np.float32))

    rgba = np.concatenate([out, (alpha * 255)[..., None]], axis=-1)
    img = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")

    # Кромка после заливки ступенчатая — размываем альфу на полпикселя.
    a = img.split()[-1].filter(ImageFilter.GaussianBlur(0.6))
    img.putalpha(a)
    img.save(dst, optimize=True)
    print(f"выход: {dst}  {os.path.getsize(dst) / 1024:.0f} КБ")

    found = measure(rgb, obj)
    if found.get("window"):
        print(f'\n  "window": {found["window"]},')
    if len(found.get("keys", [])) == 3:
        print('  "keys": [')
        names = ["назад", "пуск", "вперёд"]
        for box, name in zip(found["keys"], names):
            print(f"    {box},   // {name}")
        print("  ]")
    else:
        print(f"\n  клавиш найдено: {len(found.get('keys', []))} — померить вручную")

    return 0


if __name__ == "__main__":
    sys.exit(main())
