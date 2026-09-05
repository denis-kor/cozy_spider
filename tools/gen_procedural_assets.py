"""
Генератор процедурных ассетов для Cozy Spider.

Эти текстуры НЕ рисуются нейросетью — они математические и должны быть
идеально тайлящимися. Спектральный метод (случайный спектр с завалом по
степенному закону -> обратное БПФ) даёт периодичность по построению:
результат бесшовен без единого ручного шва.

Выход: public/assets/scene/common/  (PNG lossless — см. ⚠️1 в §6 дока:
нормали нельзя жать с потерями, R/G/B там не цвет, а компоненты вектора)

Запуск:  python tools/gen_procedural_assets.py
"""
from __future__ import annotations

import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets", "scene", "common")


# --------------------------------------------------------------------------- #
#  Спектральный шум: тайлится по построению
# --------------------------------------------------------------------------- #
def spectral_field(size: int, seed: int, power: float = 2.4,
                   aniso_x: float = 1.0, aniso_y: float = 1.0,
                   f_lo: float = 2.0, f_hi: float = 64.0) -> np.ndarray:
    """Периодическое скалярное поле [0..1] с полосовым спектром."""
    rng = np.random.default_rng(seed)

    fy = np.fft.fftfreq(size)[:, None] * size   # циклы на текстуру
    fx = np.fft.fftfreq(size)[None, :] * size

    r = np.sqrt((fx * aniso_x) ** 2 + (fy * aniso_y) ** 2)
    r[0, 0] = 1e-6

    amp = r ** (-power)
    # полосовой фильтр: убираем «пятна» на низах и алиасинг на верхах
    amp *= np.exp(-((f_lo / np.maximum(r, 1e-6)) ** 4))
    amp *= np.exp(-((r / f_hi) ** 4))
    amp[0, 0] = 0.0

    spec = amp * np.exp(1j * rng.uniform(0.0, 2.0 * np.pi, (size, size)))
    field = np.fft.ifft2(spec).real

    field -= field.min()
    field /= max(field.max(), 1e-9)
    return field


def height_to_normal(h: np.ndarray, strength: float) -> np.ndarray:
    """Центральные разности через np.roll -> нормаль остаётся тайлящейся."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5

    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(h)

    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx * inv, ny * inv, nz * inv], axis=-1)


def save_rgba(path: str, rgba: np.ndarray) -> None:
    arr = np.clip(rgba * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(arr, mode="RGBA").save(path, optimize=True)
    kb = os.path.getsize(path) / 1024.0
    print(f"  {os.path.basename(path):<24} {arr.shape[1]}x{arr.shape[0]}  {kb:6.1f} КБ")


# --------------------------------------------------------------------------- #
#  Ассеты
# --------------------------------------------------------------------------- #
def gen_water_normal(size: int = 512) -> None:
    """
    Два слоя ряби с разной анизотропией. В рантайме шейдер скроллит их
    с разной скоростью и складывает — так пропадает ощущение бегущей
    текстуры и появляется интерференция, как на настоящей воде.

    RGB — нормаль, A — высота (шейдер берёт её для бликов и пены у кромки).
    """
    # aniso_x > 1 штрафует частоты по X -> детали вытянуты вдоль X.
    # Это перспективное укорочение: у пруда, уходящего от зрителя,
    # волны читаются как длинные горизонтальные полосы, а не как рябь-манка.
    h1 = spectral_field(size, seed=1337, power=2.2, aniso_x=3.2, aniso_y=1.0,
                        f_lo=2.0, f_hi=14.0)
    h2 = spectral_field(size, seed=4242, power=1.8, aniso_x=2.2, aniso_y=1.0,
                        f_lo=6.0, f_hi=34.0)
    h = 0.75 * h1 + 0.25 * h2
    h = (h - h.min()) / max(h.max() - h.min(), 1e-9)

    n = height_to_normal(h, strength=size * 0.10)
    rgba = np.concatenate([n * 0.5 + 0.5, h[..., None]], axis=-1)
    save_rgba(os.path.join(OUT, "water-normal.png"), rgba)


def gen_fbm_noise(size: int = 256) -> None:
    """
    Универсальный шум. Каналы независимы — один ассет закрывает четыре нужды:
      R — flicker лампы (низкая частота, плавный)
      G — ветер (средняя частота)
      B — зерно/пыль (высокая частота)
      A — джиттер частиц (белый)
    """
    r = spectral_field(size, seed=11, power=2.8, f_lo=1.5, f_hi=8.0)
    g = spectral_field(size, seed=22, power=2.4, f_lo=3.0, f_hi=20.0)
    b = spectral_field(size, seed=33, power=1.9, f_lo=8.0, f_hi=64.0)
    a = spectral_field(size, seed=44, power=0.6, f_lo=1.0, f_hi=110.0)
    save_rgba(os.path.join(OUT, "noise-fbm.png"),
              np.stack([r, g, b, a], axis=-1))


def gen_rain_streak(w: int = 32, h: int = 128) -> None:
    """Одна капля дождя: вертикальный штрих с мягкими концами. Для инстансинга."""
    yy = np.linspace(0.0, 1.0, h)[:, None]
    xx = np.linspace(-1.0, 1.0, w)[None, :]

    across = np.exp(-(xx ** 2) / (2 * 0.16 ** 2))          # гаусс поперёк
    along = np.sin(np.pi * yy) ** 0.6                       # затухание к концам
    a = np.clip(across * along, 0.0, 1.0)

    rgb = np.ones((h, w, 3), dtype=np.float64)
    save_rgba(os.path.join(OUT, "rain-streak.png"),
              np.concatenate([rgb, a[..., None]], axis=-1))


def gen_dust_mote(size: int = 64) -> None:
    """Пылинка/светлячок: мягкое пятно с лёгким ореолом."""
    c = (size - 1) / 2.0
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.sqrt((xx - c) ** 2 + (yy - c) ** 2) / c

    core = np.exp(-(d ** 2) / (2 * 0.17 ** 2))
    halo = np.exp(-(d ** 2) / (2 * 0.42 ** 2)) * 0.28
    a = np.clip(core + halo, 0.0, 1.0) * (d < 1.0)

    rgb = np.ones((size, size, 3), dtype=np.float64)
    save_rgba(os.path.join(OUT, "dust-mote.png"),
              np.concatenate([rgb, a[..., None]], axis=-1))


def gen_light_cookie(size: int = 256) -> None:
    """
    Гало лампы. Не чистый гаусс: у настоящего фитиля ядро резче, а хвост длиннее.
    R — ядро, G — широкий разлив, B — «дымка» вокруг стекла. Шейдер смешивает
    каналы по flicker, поэтому пламя не просто мигает яркостью, а меняет форму.
    """
    c = (size - 1) / 2.0
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.clip(np.sqrt((xx - c) ** 2 + (yy - c) ** 2) / c, 0.0, 1.0)

    core = np.exp(-(d ** 2) / (2 * 0.10 ** 2))
    spill = (1.0 - d) ** 2.6
    haze = np.exp(-(d ** 2) / (2 * 0.55 ** 2)) * (1.0 - d)

    a = np.clip(np.maximum(core, spill * 0.9), 0.0, 1.0)
    save_rgba(os.path.join(OUT, "light-cookie.png"),
              np.stack([core, spill, haze, a], axis=-1))


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    print(f"Процедурные ассеты -> {os.path.relpath(OUT, ROOT)}")
    gen_water_normal()
    gen_fbm_noise()
    gen_rain_streak()
    gen_dust_mote()
    gen_light_cookie()
    print("Готово.")


if __name__ == "__main__":
    main()
