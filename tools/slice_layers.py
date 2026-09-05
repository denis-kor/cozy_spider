"""
Подготовка слоёв сцены: проверка, публикация и подключение к манифесту.

Нейросеть выдаёт слои, а этот скрипт делает скучную, но обязательную
часть: следит, чтобы все слои были одного размера, имели альфу и попали
в манифест под правильными именами.

Ошибка тут дороже кривой дорисовки. Движок ставит все слои в одну точку и
масштабирует одинаково — слой, обрезанный по содержимому, разъедется с
остальными, и это будет выглядеть как баг параллакса, а не как проблема
экспорта.

Команды
-------
  python tools/slice_layers.py cut      маски -> слои с альфой + дырки под инпейнт
  python tools/slice_layers.py verify   проверить готовые слои
  python tools/slice_layers.py wire     опубликовать и включить в scene.json

Раскладка папок
---------------
  art/scene/pond/source.png        расширенный холст 2560x1600
  art/scene/pond/masks/NN-имя.png  маски слоёв (белое = слой)
  art/scene/pond/layers/NN-имя.png готовые слои с прозрачностью
  art/scene/pond/holes/NN-имя.png  холст с вырезанным слоем — вход инпейнта
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageFilter

# Консоль Windows по умолчанию в cp1251: любой символ вне неё роняет вывод
# с UnicodeEncodeError посреди работы. Дешевле переключить поток, чем потом
# гадать, почему скрипт умер на печати отчёта.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def set_scene(scene: str) -> None:
    """Пути зависят от сцены. Раньше pond была константой; теперь сцен
    несколько (платные паки), а раскладка папок у всех одна."""
    global SCENE, ART, SOURCE, MASKS, LAYERS, HOLES, PUBLIC, MANIFEST
    SCENE = scene
    ART = os.path.join(ROOT, "art", "scene", SCENE)
    SOURCE = os.path.join(ART, "source.png")
    MASKS = os.path.join(ART, "masks")
    LAYERS = os.path.join(ART, "layers")
    HOLES = os.path.join(ART, "holes")
    PUBLIC = os.path.join(ROOT, "public", "assets", "scene", SCENE)
    MANIFEST = os.path.join(PUBLIC, "scene.json")


set_scene("pond")

WIND_SUFFIX = ".wind.png"


def load_manifest() -> dict:
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def save_manifest(data: dict) -> None:
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def planned(manifest: dict) -> list[dict]:
    return manifest.get("plannedLayers", [])


# --------------------------------------------------------------------------- #
#  cut: маски -> слои и дырки
# --------------------------------------------------------------------------- #
def cmd_cut(feather: float) -> int:
    """
    Разложить холст по маскам.

    Кроме самого слоя пишет «дырку» — тот же холст с вырезанной областью.
    Именно её скармливают инпейнту: модель должна видеть окружение, чтобы
    достроить то, что было за объектом.
    """
    if not os.path.exists(SOURCE):
        print(f"нет исходника: {os.path.relpath(SOURCE, ROOT)}")
        print("положи туда расширенный холст 2560x1600")
        return 1
    if not os.path.isdir(MASKS):
        print(f"нет папки с масками: {os.path.relpath(MASKS, ROOT)}")
        return 1

    src = Image.open(SOURCE).convert("RGB")
    w, h = src.size
    rgb = np.asarray(src, dtype=np.float32) / 255.0

    os.makedirs(LAYERS, exist_ok=True)
    os.makedirs(HOLES, exist_ok=True)

    all_png = sorted(n for n in os.listdir(MASKS) if n.lower().endswith(".png"))
    names = [n for n in all_png if not n.endswith(WIND_SUFFIX)]
    winds = [n for n in all_png if n.endswith(WIND_SUFFIX)]
    if not names:
        print(f"в {os.path.relpath(MASKS, ROOT)} нет масок")
        return 1

    print(f"холст {w}x{h}, масок: {len(names)}\n")

    for name in names:
        mask_img = Image.open(os.path.join(MASKS, name))
        if mask_img.size != (w, h):
            print(f"  ПРОПУСК {name}: маска {mask_img.size}, а холст {(w, h)}")
            continue

        mask_img = mask_img.convert("L")
        if feather > 0:
            # Растушёвка в один-два пикселя убирает «лесенку» по краю выреза.
            # Больше нельзя: слой начнёт просвечивать соседним.
            mask_img = mask_img.filter(ImageFilter.GaussianBlur(feather))

        alpha = np.asarray(mask_img, dtype=np.float32) / 255.0

        layer = np.concatenate([rgb, alpha[..., None]], axis=-1)
        Image.fromarray((layer * 255 + 0.5).astype(np.uint8), "RGBA").save(
            os.path.join(LAYERS, name), optimize=True
        )

        hole = np.concatenate([rgb, (1.0 - alpha)[..., None]], axis=-1)
        Image.fromarray((hole * 255 + 0.5).astype(np.uint8), "RGBA").save(
            os.path.join(HOLES, name), optimize=True
        )

        print(f"  {name:<24} покрытие {alpha.mean() * 100:5.1f}%")

    # Маски ветра слоями не являются, но идут тем же маршрутом: рисуют их в
    # оттенках серого, а шейдер читает жёсткость из АЛЬФЫ. Без перекладки
    # серого в альфу маска молча окажется полностью непрозрачной, и ветер
    # задует весь слой равномерно, включая стволы.
    for name in winds:
        img = Image.open(os.path.join(MASKS, name))
        if img.size != (w, h):
            print(f"  ПРОПУСК {name}: маска {img.size}, а холст {(w, h)}")
            continue

        stiff = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
        white = np.ones((h, w, 3), dtype=np.float32)
        out = np.concatenate([white, stiff[..., None]], axis=-1)
        Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(
            os.path.join(LAYERS, name), optimize=True
        )
        print(f"  {name:<24} ветер, средняя жёсткость {stiff.mean() * 100:5.1f}%")

    print(f"\nслои  -> {os.path.relpath(LAYERS, ROOT)}")
    print(f"дырки -> {os.path.relpath(HOLES, ROOT)}  (это вход для инпейнта)")
    return 0


# --------------------------------------------------------------------------- #
#  verify: всё ли сходится
# --------------------------------------------------------------------------- #
def cmd_verify() -> int:
    manifest = load_manifest()
    specs = planned(manifest)
    if not specs:
        print("в scene.json нет plannedLayers — нечего проверять")
        return 1

    if not os.path.isdir(LAYERS):
        print(f"нет папки {os.path.relpath(LAYERS, ROOT)} — слои ещё не готовы")
        return 1

    problems: list[str] = []
    sizes: dict[tuple[int, int], list[str]] = {}
    found = 0

    print(f"проверяю {os.path.relpath(LAYERS, ROOT)}\n")

    for spec in specs:
        path = os.path.join(LAYERS, spec["src"])
        if not os.path.exists(path):
            print(f"  {spec['src']:<24} — нет файла")
            continue

        found += 1
        img = Image.open(path)
        sizes.setdefault(img.size, []).append(spec["src"])

        notes = []
        if img.mode != "RGBA":
            problems.append(f"{spec['src']}: режим {img.mode}, нужен RGBA с альфой")
            notes.append("НЕТ АЛЬФЫ")
        else:
            alpha = np.asarray(img.split()[-1], dtype=np.float32) / 255.0
            cover = alpha.mean()
            if cover > 0.999:
                notes.append("альфа сплошь непрозрачная — слой ничего не откроет")
            notes.append(f"покрытие {cover * 100:.1f}%")

        # Маска ветра нужна только тем слоям, которые её объявили.
        if spec.get("mask", "").endswith(WIND_SUFFIX):
            wind = os.path.join(LAYERS, spec["mask"])
            if not os.path.exists(wind):
                problems.append(f"{spec['src']}: нет маски ветра {spec['mask']}")
                notes.append("НЕТ МАСКИ ВЕТРА")
            else:
                wimg = Image.open(wind)
                if wimg.mode != "RGBA":
                    # Маску ветра рисуют мягкой кистью в оттенках серого —
                    # это нормальный вход, а не ошибка. Перекладку серого в
                    # альфу берёт на себя wire, требовать RGBA от художника
                    # значит требовать лишний шаг ради ничего.
                    notes.append(f"маска ветра в {wimg.mode}, wire переложит в альфу")
                elif int(np.asarray(wimg.split()[-1]).min()) == 255:
                    problems.append(
                        f"{spec['mask']}: альфа сплошь 255 — ветер задует весь слой равномерно")

        print(f"  {spec['src']:<24} {img.size[0]}x{img.size[1]}  {', '.join(notes)}")

    print()
    if found == 0:
        print("не найдено ни одного слоя")
        return 1

    # Разъехавшиеся размеры — самая дорогая ошибка: движок ставит все слои
    # в одну точку, и слой другого размера сместится относительно остальных.
    if len(sizes) > 1:
        problems.append("слои разного размера — параллакс разъедется:")
        for size, files in sizes.items():
            problems.append(f"    {size[0]}x{size[1]}: {', '.join(files)}")

    design = tuple(manifest["designSize"])
    only_size = next(iter(sizes)) if len(sizes) == 1 else None
    if only_size and only_size != design:
        print(f"размер слоёв {only_size[0]}x{only_size[1]} "
              f"!= designSize {design[0]}x{design[1]} — поправлю при wire\n")

    if problems:
        print("Проблемы:")
        for p in problems:
            print(f"  - {p}")
        return 1

    print(f"Всё сходится: {found} из {len(specs)} слоёв готовы.")
    if found < len(specs):
        print("Остальные можно донести позже — wire подключит то, что есть.")
    return 0


# --------------------------------------------------------------------------- #
#  wire: опубликовать и включить
# --------------------------------------------------------------------------- #
# Слой 2560×1600 RGBA в PNG весит около 5 МБ — двенадцать таких это 60 МБ
# только на фон. WebP сжимает их в 12 раз при ошибке 1/255 по цвету, что на
# живописной картинке не видно.
#
# Альфа при этом сохраняется БЕЗ потерь (alpha_quality=100), и это не
# перестраховка: у слоёв по контуру идёт растушёванная кайма в 45 px,
# которая закрывает щели между слоями при параллаксе. Помятая альфа
# вернула бы эти щели.
WEBP_QUALITY = 95


def to_webp(src: str, dst_png: str) -> str:
    """Опубликовать как WebP. Возвращает итоговое имя файла."""
    dst = os.path.splitext(dst_png)[0] + ".webp"
    with Image.open(src) as img:
        img.convert("RGBA").save(
            dst, "WEBP", quality=WEBP_QUALITY, alpha_quality=100, method=5
        )
    return dst


def publish_mask(src: str, dst: str) -> None:
    """
    Положить маску в public, переложив яркость в альфу.

    Шейдер читает жёсткость из альфа-канала. Маска, нарисованная в сером,
    после наивного копирования оказалась бы полностью непрозрачной, и
    ветер задул бы весь слой равномерно — вместе со стволами. Ошибка
    молчаливая: ничего не падает, просто листва ведёт себя неправдоподобно.
    """
    img = Image.open(src)
    if img.mode != "RGBA":
        stiff = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
        h, w = stiff.shape
        white = np.ones((h, w, 3), dtype=np.float32)
        rgba = Image.fromarray(
            (np.concatenate([white, stiff[..., None]], axis=-1) * 255 + 0.5).astype(np.uint8),
            "RGBA",
        )
        print(f"  {os.path.basename(src)}: {img.mode} -> RGBA, яркость переложена в альфу")
    else:
        rgba = img.convert("RGBA")

    rgba.save(
        os.path.splitext(dst)[0] + ".webp",
        "WEBP", quality=WEBP_QUALITY, alpha_quality=100, method=5,
    )


def cmd_wire(keep_placeholder: bool) -> int:
    manifest = load_manifest()
    specs = planned(manifest)
    if not specs:
        print("в scene.json нет plannedLayers")
        return 1

    ready: list[dict] = []
    size: tuple[int, int] | None = None

    for spec in specs:
        src = os.path.join(LAYERS, spec["src"])
        if not os.path.exists(src):
            continue

        spec_src_name = spec["src"]
        img = Image.open(src)
        if size is None:
            size = img.size
        elif img.size != size:
            print(f"ОТКАЗ: {spec['src']} имеет размер {img.size}, "
                  f"а предыдущие слои {size}. Слои обязаны совпадать.")
            return 1

        to_webp(src, os.path.join(PUBLIC, spec["src"]))
        spec = {**spec, "src": os.path.splitext(spec["src"])[0] + ".webp"}

        mask = spec.get("mask")
        if mask:
            mask_src = os.path.join(LAYERS, mask)
            if mask == spec_src_name:
                # Слой сам себе маска — файл уже опубликован выше.
                spec["mask"] = spec["src"]
            elif os.path.exists(mask_src):
                publish_mask(mask_src, os.path.join(PUBLIC, mask))
                spec["mask"] = os.path.splitext(mask)[0] + ".webp"
            else:
                # Без маски эффект применить не к чему — отключаем его,
                # но сам слой оставляем: он всё равно нужен для параллакса.
                spec = {k: v for k, v in spec.items() if k not in ("effects", "mask")}

        ready.append(spec)

    if not ready:
        print(f"в {os.path.relpath(LAYERS, ROOT)} нет ни одного слоя из манифеста")
        return 1

    if keep_placeholder:
        placeholder = [l for l in manifest["layers"] if l["id"] == "placeholder"]
        manifest["layers"] = placeholder + ready
    else:
        manifest["layers"] = ready

    if size:
        manifest["designSize"] = [size[0], size[1]]

    save_manifest(manifest)

    print(f"опубликовано слоёв: {len(ready)}")
    print(f"designSize -> {size[0]}x{size[1]}")
    print(f"манифест: {os.path.relpath(MANIFEST, ROOT)}")
    print("\nplannedLayers оставлены на месте — они и есть спека нарезки.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scene", default="pond",
                        help="имя сцены: art/scene/<имя> -> public/assets/scene/<имя>")
    sub = parser.add_subparsers(dest="cmd", required=True)

    cut = sub.add_parser("cut", help="маски -> слои с альфой и дырки под инпейнт")
    cut.add_argument("--feather", type=float, default=1.2,
                     help="растушёвка края маски в пикселях (по умолчанию 1.2)")

    sub.add_parser("verify", help="проверить готовые слои")

    wire = sub.add_parser("wire", help="опубликовать слои и включить их в scene.json")
    wire.add_argument("--keep-placeholder", action="store_true",
                      help="оставить слой-плейсхолдер под новыми слоями")

    args = parser.parse_args()
    set_scene(args.scene)

    if args.cmd == "cut":
        return cmd_cut(args.feather)
    if args.cmd == "verify":
        return cmd_verify()
    if args.cmd == "wire":
        return cmd_wire(args.keep_placeholder)
    return 1


if __name__ == "__main__":
    sys.exit(main())
