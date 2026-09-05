"""
Подключение нарисованных иллюстраций колоды.

Кладёшь картинки в art/deck/, запускаешь — они уезжают в public/ и
прописываются в манифест. Код колоды при этом не трогается: атлас сам
подставит иллюстрацию вместо заглушки.

Раскладка
---------
  art/deck/faces/S1.png      туз пик      (S/H/D/C + ранг 1..13)
  art/deck/faces/S7.png      семёрка пик
  art/deck/faces/C13.png     король треф
  ...                        всего 52
  art/deck/back.png          рубашка

Картинка занимает карту ЦЕЛИКОМ и приходит БЕЗ текста. Ранг и масть
рисуются кодом поверх неё на угловой плашке: модели не умеют надёжно
рисовать буквы, а ранг — единственное, что игрок обязан прочесть с
накрытой карты.

Запуск
------
  python tools/wire_deck.py          проверить и подключить
  python tools/wire_deck.py --check  только проверить
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys

from PIL import Image

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def set_deck(deck: str) -> None:
    """Базовая колода живёт в art/deck; платные — в art/deck-<имя>."""
    global ART, FACES, PUBLIC
    suffix = f"-{deck}" if deck else ""
    ART = os.path.join(ROOT, "art", f"deck{suffix}")
    FACES = os.path.join(ART, "faces")
    PUBLIC = os.path.join(ROOT, "public", "assets", f"deck{suffix}")


set_deck("")

# Иллюстрация занимает карту целиком, поэтому её пропорции — это пропорции
# карты. CARD_ASPECT живёт в src/engine/cards/deckAtlas.ts.
CARD_ASPECT = 1.45
FACE_ASPECT = 1 / CARD_ASPECT
BACK_ASPECT = 1 / CARD_ASPECT

# Иллюстрация с заметно другим соотношением сторон растянется по окошку.
ASPECT_TOLERANCE = 0.06

# Публикуем в WebP: живописная картинка сжимается в разы при незаметной
# ошибке. У лиц альфы нет — карта прямоугольная, скругление даёт маска.
WEBP_QUALITY = 95

SUITS = ("S", "H", "D", "C")
RANKS = {
    1: "туз", 2: "двойка", 3: "тройка", 4: "четвёрка", 5: "пятёрка",
    6: "шестёрка", 7: "семёрка", 8: "восьмёрка", 9: "девятка", 10: "десятка",
    11: "валет", 12: "дама", 13: "король",
}
SUIT_NAMES = {"S": "пики", "H": "червы", "D": "бубны", "C": "трефы"}


def describe(key: str) -> str:
    suit, rank = key[0], int(key[1:])
    return f"{RANKS.get(rank, rank)} {SUIT_NAMES.get(suit, suit)}"


def check_aspect(path: str, expected: float, label: str) -> tuple[bool, str]:
    with Image.open(path) as img:
        w, h = img.size
        actual = w / h
    off = abs(actual - expected) / expected
    note = f"{w}x{h}  {actual:.2f}"
    if off > ASPECT_TOLERANCE:
        return False, f"{note}  — нужно ~{expected:.2f}, иначе {label} растянется"
    return True, note


def collect(numeric: bool) -> tuple[dict[str, str], str | None, list[str]]:
    figures: dict[str, str] = {}
    problems: list[str] = []

    skipped_numeric = 0
    if os.path.isdir(FACES):
        for suit in SUITS:
            for rank in RANKS:
                key = f"{suit}{rank}"
                path = os.path.join(FACES, f"{key}.png")
                if not os.path.exists(path):
                    continue
                # Политика числовых 2..10 — на колоду, и живёт она в
                # манифесте: движок грузит всё, что в нём перечислено, и
                # ничего сверх. Базовая колода публикуется БЕЗ числовых
                # (полсотни пейзажей в раскладке сливались в шум), пак
                # вроде таро — с ними: там минорка и есть характер колоды.
                if not numeric and 2 <= rank <= 10:
                    skipped_numeric += 1
                    continue
                ok, note = check_aspect(path, FACE_ASPECT, "картинка")
                print(f"  {key:<5} {describe(key):<18} {note}")
                if not ok:
                    problems.append(f"{key}.png: {note}")
                figures[key] = f"faces/{key}.png"  # расширение правится при публикации

    back = None
    back_path = os.path.join(ART, "back.png")
    if os.path.exists(back_path):
        ok, note = check_aspect(back_path, BACK_ASPECT, "рубашка")
        print(f"  back  {'рубашка':<16} {note}")
        if not ok:
            problems.append(f"back.png: {note}")
        back = "back.png"

    if skipped_numeric:
        print(f"  числовые 2..10 пропущены ({skipped_numeric} шт.) — "
              f"эта колода играет их пипсами; подключить: --numeric")

    return figures, back, problems


def report_missing(have: dict[str, str]) -> None:
    """
    Показать, каких лиц ещё нет.

    Карта без картинки не ломается — она рисуется процедурной заглушкой,
    бумажным лицом с пипсами. Именно поэтому недостачу легко не заметить:
    колода выглядит целой, просто часть карт другая. Список нужен, чтобы
    было видно, сколько работы осталось.
    """
    missing: dict[str, list[str]] = {}
    for suit in SUITS:
        # Числовые не в счёт: им картинка не положена, заглушка — их норма.
        gap = [f"{suit}{rank}" for rank in RANKS
               if not 2 <= rank <= 10 and f"{suit}{rank}" not in have]
        if gap:
            missing[suit] = gap

    if not missing:
        print("колода полная")
        return

    total = sum(len(v) for v in missing.values())
    print(f"\nне хватает {total}, эти карты идут заглушками:")
    for suit, gap in missing.items():
        print(f"  {SUIT_NAMES[suit]:<7} {' '.join(gap)}")


def fill_gaps(figures: dict[str, str], donor: str) -> int:
    """
    Закрыть пробелы картинками той же позиции из масти-донора.

    Временная мера, пока нарисована не вся колода. Червовая семёрка берёт
    картинку пиковой: масть при этом читается по угловому знаку и цвету,
    а стол перестаёт быть лоскутным — половина карт с пейзажем, половина
    бумажных.

    Подмена пишется в манифест ЯВНО, а не прячется в коде. Иначе через
    неделю непонятно, почему две карты одинаковые: то ли так задумано, то
    ли что-то сломалось.
    """
    if not donor or donor not in SUITS:
        return 0

    borrowed = 0
    for suit in SUITS:
        if suit == donor:
            continue
        for rank in RANKS:
            key = f"{suit}{rank}"
            if key in figures:
                continue
            source = figures.get(f"{donor}{rank}")
            if source:
                figures[key] = source
                borrowed += 1

    if borrowed:
        print(f"  {borrowed} лиц взяты из масти {SUIT_NAMES[donor]} — "
              f"пока не нарисованы свои")
    return borrowed


def publish(src: str, dst: str, max_width: int) -> int:
    """
    Положить картинку в public, уменьшив до рабочего размера.

    Окошко на карте рисуется шириной около сотни пикселей даже на плотном
    экране. Возить туда мастер 1024px — это двадцатикратная переплата
    трафиком за пиксели, которые атлас всё равно выбросит при
    растеризации.

    Мастера остаются в art/ нетронутыми: если однажды понадобится колода
    крупнее, публикация переделывается одной командой.
    """
    with Image.open(src) as img:
        before = os.path.getsize(src)

        # Карта кладёт картинку по принципу cover, поэтому жать можно
        # только до размера, который карта реально использует ПО ОБЕИМ
        # осям. Горизонтальный мастер 1024x832, ужатый тупо до ширины 512,
        # становится 512x416 — и карта растягивает его по высоте обратно
        # в 1.8 раза. Мыло на выходе выглядело как «плохое разрешение
        # колоды», хотя мастер был в порядке.
        need_h = max_width * CARD_ASPECT
        factor = min(1.0, max(max_width / img.width, need_h / img.height))
        if factor >= 1.0:
            out = os.path.splitext(dst)[0] + ".webp"
            img.convert("RGB").save(out, "WEBP", quality=WEBP_QUALITY, method=5)
            return before - os.path.getsize(out)

        small = img.convert("RGB").resize(
            (round(img.width * factor), round(img.height * factor)), Image.LANCZOS)

        # WebP вместо PNG: живописная картинка сжимается в разы при ошибке
        # порядка 1/255, которую на ней не видно. Альфы у лиц нет — карта
        # прямоугольная, скругление даёт маска в атласе.
        out = os.path.splitext(dst)[0] + ".webp"
        small.save(out, "WEBP", quality=WEBP_QUALITY, method=5)
        return before - os.path.getsize(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--deck", default="", metavar="ИМЯ",
                        help="колода пака: art/deck-<имя> -> public/assets/deck-<имя>; "
                             "по умолчанию базовая art/deck")
    parser.add_argument("--check", action="store_true", help="только проверить, ничего не копировать")
    parser.add_argument("--numeric", action="store_true",
                        help="публиковать и числовые 2..10 (по умолчанию они "
                             "играются пипсами, картинки не публикуются)")
    parser.add_argument("--no-index", action="store_true",
                        help="не рисовать угловой индекс поверх картинок: "
                             "номинал нарисован в самом арте (пишет "
                             "\"index\": false в манифест)")
    parser.add_argument("--max-width", type=int, default=512,
                        help="ширина публикуемых картинок, px (по умолчанию 512)")
    parser.add_argument("--fill-from", default="S", metavar="МАСТЬ",
                        help="чем закрывать недостающие лица: картинкой того же "
                             "ранга из указанной масти (по умолчанию S)")
    parser.add_argument("--force", action="store_true",
                        help="опубликовать несмотря на неверные пропорции: "
                             "картинка будет обрезана по принципу cover")
    args = parser.parse_args()
    set_deck(args.deck)

    if not os.path.isdir(ART):
        print(f"нет папки {os.path.relpath(ART, ROOT)} — иллюстраций пока нет")
        print("это нормально: колода играется на процедурных заглушках")
        return 0

    print(f"смотрю {os.path.relpath(ART, ROOT)}\n")
    figures, back, problems = collect(args.numeric)

    if not figures and not back:
        print("\nни одной картинки не найдено")
        print(f"ожидаю {os.path.relpath(FACES, ROOT)}/S1.png … C13.png")
        return 1

    print(f"\nнайдено: {len(figures)} из 52 лиц" + (", рубашка" if back else ""))
    borrowed = fill_gaps(figures, args.fill_from)
    if not borrowed:
        report_missing(figures)

    if problems:
        # Пропорции — предупреждение, а не отказ. Картинка всё равно
        # ложится по принципу cover, и обрезанные края лучше, чем
        # неопубликованная колода.
        print("\nПропорции отличаются от карты — края будут срезаны:")
        for p in problems:
            print(f"  - {p}")
        print("\nЧтобы ничего не терялось, перегенерируй в пропорции карты.")

    if args.check:
        print("\nпроверка пройдена (--check: ничего не копировал)")
        return 0

    os.makedirs(os.path.join(PUBLIC, "faces"), exist_ok=True)
    saved = 0
    # Одолженные лица ссылаются на один и тот же файл — публикуем его раз.
    for rel in sorted(set(figures.values())):
        saved += publish(os.path.join(ART, rel), os.path.join(PUBLIC, rel), args.max_width)
    if back:
        saved += publish(os.path.join(ART, back), os.path.join(PUBLIC, back), args.max_width)

    if saved > 0:
        print(f"\nуменьшение до {args.max_width}px сэкономило {saved / 1024 / 1024:.1f} МБ")

    def as_webp(rel: str) -> str:
        return os.path.splitext(rel)[0] + ".webp"

    manifest: dict = {}
    if figures:
        manifest["faces"] = {k: as_webp(v) for k, v in sorted(figures.items())}
    if back:
        manifest["back"] = as_webp(back)
    if args.no_index:
        manifest["index"] = False

    path = os.path.join(PUBLIC, "deck.json")
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"\nопубликовано -> {os.path.relpath(PUBLIC, ROOT)}")
    print(f"манифест     -> {os.path.relpath(path, ROOT)}")
    print("\nОстальные карты остаются на заглушках, пока не донесёшь картинки.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
