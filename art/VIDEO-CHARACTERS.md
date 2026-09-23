# Персонажи для видео: котик и паук

Маскоты для роликов и аватарки канала. Котик — герой, паук — антагонист,
которого котик вечно пытается поймать и никогда не ловит.

Стиль — рисованная целл-анимация 90-х (то, что обычно называют
Ghibli-луком): чистый контур, гуашевая заливка, акварельный фон, тёплый
свет лампы против холодной сине-зелёной среды. Тот же свет, что в игре
(§15.3 контекст-дока: один источник на всю сцену).

---

## Порядок работы

1. **Лист котика** — 4 ракурса на одном изображении
2. **Лист паука** — то же
3. **Ключевой кадр** — оба персонажа в одной композиции, уже готовая сцена
4. **Видео** — анимируется ключевой кадр (image-to-video), не текст

Шаги 1–2 дают эталон, по которому сверяются все последующие кадры. Шаг 3 —
то, что реально скармливается видеомодели.

**Ключевой кадр важнее рефов.** Два отдельных персонажа, приложенных как
референсы, модель сводит в одном кадре плохо: теряет пропорции, путает,
кто где. Один готовый кадр с обоими она просто оживляет — это надёжнее.
Рефы нужны, чтобы этот кадр нарисовать, а не чтобы отдать его видеомодели.

---

## Котик: не генерировать с нуля

Котик уже существует — `art/scene/pond/cat/cat-open.png`. Его не
придумывают заново, его **портируют** в другую технику: реф на вход,
image-to-image или reference-режим, сила 0.4–0.55.

Постоянные признаки, по которым зритель узнаёт персонажа. Меняться не
должны нигде и никогда:

| | |
|---|---|
| Тело | сплошной матовый чёрный, без бликов на шерсти, силуэт округлый |
| Глаза | огромные круглые белые, зрачок маленький чёрный, широко расставлены |
| Уши | крупные треугольные, внутри бледно-лавандовые |
| Нос | крошечный тёмно-лиловый треугольник |
| Пропорции | голова почти с туловище, лапы короткие |

В игре котик плоский и графичный — он должен читаться силуэтом в 40 px над
водой. В видео его можно писать мягче и объёмнее, но пять признаков выше
переносятся дословно, иначе это другой кот.

---

## Паук: сажевый дух, а не паук

Мультяшный — значит круглый, пушистый, безобидный. Референс по духу —
сусуватари, чёрные сажевые шарики с большими глазами: та же чёрная масса,
что и котик, но пушистая и мелкая. Это связывает двух персонажей
пластически и снимает вопрос «не страшно ли детям».

| | |
|---|---|
| Тело | круглый комок тёмно-угольного пуха, размером со сливу |
| Лапы | восемь коротких пружинистых, кончики чуть подкручены |
| Глаза | два больших блестящих с крупным бликом + четыре точки выше |
| Рот | не рисуется, клыков нет |
| Характер | нахальный, любопытный, всегда на полшага быстрее котика |

---

## Промпты

Английский. У Flux негатив не работает (§18.5) — нужное описывается
позитивно; для моделей, где негатив работает, он вынесен отдельно.

**Слово «Ghibli» в промпт не писать.** Часть сервисов режет названия
студий, часть отдаёт на него карикатуру-клише. Лук описывается техникой:
`hand-painted cel animation`, `gouache`, `watercolour background`,
`1990s Japanese animated family film`.

### 1. Лист котика

```
Character reference sheet of a small black cat mascot, four views in one
image: front, three-quarter, side profile, back.
Pure matte black fur with no highlights on the body, rounded silhouette,
soft belly, short legs, head almost as large as the body.
Huge round white eyes with small black pupils, wide-set, very expressive.
Large triangular ears with pale lavender inner ears. Tiny dark purple
triangular nose, thin pale whiskers.
Hand-painted cel animation: clean confident ink outline, flat gouache fill,
soft watercolour shading, gentle warm rim light from the left.
Cosy 1990s Japanese animated family film aesthetic, childlike proportions,
friendly and warm.
Plain flat cream background, even neutral lighting, no cast shadow,
character fully inside the frame with margin on all sides.
```

Негатив: `text, letters, numbers, watermark, logo, realistic fur texture,
photorealistic, 3d render, plastic, glossy eyes, sharp teeth, horror`

### 2. Лист паука

```
Character reference sheet of a tiny cartoon spider mascot, four views in
one image: front, three-quarter, side profile, back.
Round fuzzy body like a soft pom-pom of dark charcoal fur, the size of a
plum. Eight short springy legs with slightly curled tips. No fangs, no
visible mouth.
Two huge round glossy eyes with large highlights, curious and mischievous,
four tiny dot eyes above them.
Hand-painted cel animation: clean ink outline, flat gouache fill, soft
watercolour shading, gentle warm rim light from the left.
Cosy 1990s Japanese animated family film aesthetic, soot-sprite charm,
harmless and adorable.
Plain flat cream background, even neutral lighting, character fully inside
the frame with margin on all sides.
```

Негатив: тот же плюс `spider web pattern, hairy realistic legs, insect
anatomy, scary, many eyes, venom`

### 3. Ключевой кадр — погоня

Тот самый кадр, который потом оживляется. Сюда рефы из 1 и 2.

```
A cosy misty pond at dusk, lily pads and tall reeds, light rain falling.
An old oil lantern glows warm amber on a weathered wooden plank.
A small black cat with huge round white eyes and pale lavender inner ears
crouches on the plank, front paw raised mid-pounce, tail up, eyes locked
upward, playful not aggressive.
A tiny round fuzzy charcoal spider with two big glossy eyes dangles on a
silk thread just out of reach above the cat, cheeky expression.
Hand-painted cel animation, painterly watercolour background, warm lantern
key light against cool blue-green ambient, soft volumetric mist, wet
reflections on the plank.
Cosy 1990s Japanese animated family film aesthetic. Cinematic composition.
```

Вертикаль под Shorts/Reels — тот же текст, в конце
`vertical 9:16 composition, cat in the lower third, spider in the upper
third, generous headroom` и параметр формата у сервиса.

### 4. Аватарка

Отдельный кадр, не кроп из предыдущего: аватарка живёт в круге 64 px, там
нужен другой масштаб.

```
Close-up portrait bust of a small black cat mascot, facing the viewer,
head and shoulders only, filling most of the frame.
Pure matte black fur, huge round white eyes with small black pupils, large
triangular ears with pale lavender inner ears, tiny dark purple nose.
A tiny round fuzzy charcoal spider with two big glossy eyes sits on top of
the cat's head, the cat's eyes rolled upward at it.
Hand-painted cel animation, clean ink outline, flat gouache fill, warm
lantern rim light from the left, simple dark blue-green background with a
soft glow.
Cosy 1990s Japanese animated family film aesthetic. Square composition,
strong readable silhouette.
```

Приёмка: уменьшить до 64×64 и посмотреть. Если не читается, что это кот и
что на нём кто-то сидит, — переделывать композицию, а не докручивать
детали.

### 5. Видеопромпт

Оживляется ключевой кадр. Внешность в промпте **не описывается** — её несёт
картинка; лишнее описание модель воспринимает как разрешение перерисовать.
Пишется только движение и камера.

```
The cat springs upward, the spider bounces out of reach on its thread,
the cat lands back on the plank and looks up. Lantern flame flickers,
rain falls softly, reeds sway. Slow subtle camera push-in.
```

Правила, которые экономят генерации:

- **Одно действие на клип.** 5 секунд — это один прыжок, а не прыжок,
  падение в воду и обида
- **Камера называется явно**, иначе модель придумает свою: `static camera`,
  `slow push-in`, `slow pan left`
- Для зацикленных заставок добавлять `the scene returns to its starting
  position, seamless loop`
- Склейка нескольких клипов надёжнее одного длинного: гонишь 3–4 по пять
  секунд и режешь

---

## Блок стиля под живой кадр

Когда ключевой кадр получился, дальше стиль держится этим блоком. Он
вставляется дословно в конец каждого промпта серии, без единого
изменённого слова.

**Главное в нём — две техники в одном кадре.** Персонажи плоские,
среда живописная. Если описать стиль общей фразой, модель либо зарисует
котика текстурой шерсти, либо упростит фон до мультика.

```
Style: hand-painted 2D cel animation, cozy Japanese animated film look.

The CHARACTERS are flat graphic animation — solid matte black silhouettes,
clean even ink edges, no fur texture, no shading or gradient on the body,
flat pale lavender ear shapes, thin white whisker lines, huge round white
eyes with small black pupils.

The ENVIRONMENT is fully painted — gouache and watercolour texture, visible
brushwork on wet wood and foliage, softly blended mist.

Light: ONE warm source, an amber oil lantern low on the left. It is the only
saturated colour in frame. Everything else stays cool — deep indigo sky,
muted teal water, desaturated green reeds — with a narrow warm peach sunset
band low on the horizon and small warm lit windows far away. Warm specular
reflections stretch along the wet planks toward the camera. Faint warm rim
light on the left edge of the characters, cool blue fill everywhere else.

Atmosphere: steady fine rain in thin pale diagonal streaks, droplets
clinging to grass blades and dripping from the wooden beam, low mist over
the far water, soft bloom around the flame and the distant windows, gentle
film grain.

Depth: three clear planes — dark out-of-focus grass across the bottom
foreground, the sharp lit subject in the middle, soft blurred pond and
treeline behind. Shallow depth of field.

Mood: quiet, warm, unhurried, faintly melancholic. Nothing threatening.
```

### Блок движения — только для видео

```
Motion: slow and calm. Rain is the only quick element in frame. The lantern
flame breathes and flickers, and its reflection on the wet wood flickers
with it. Reeds sway slightly. Water ripples in fine rings. Mist drifts.
Camera: locked off, or a very slow push-in.
Animation: limited cel animation, the characters animate as flat shapes —
they never gain fur, volume or realistic animal anatomy.
Audio: ambient only — rain, water, distant night. No speech, no dialogue,
no voiceover, no music.
```

Последняя строка обязательна: голос делается отдельно, см.
[VIDEO-VOICE.md](VIDEO-VOICE.md).

### Негатив, где он работает

```
photorealistic, 3d render, CGI, plastic, realistic fur texture, furry cat,
glossy highlights on the black body, volumetric shading on the character,
scary spider, hairy tarantula, fangs, horror, harsh contrast, oversaturated,
neon, daylight, multiple light sources, camera shake, fast motion, zoom snap,
text, letters, subtitles, watermark, logo, frame, border
```

### Грейд всё равно поплывёт

Даже при дословно одинаковом блоке модель отдаст клипы с чуть разной
цветовой температурой. Промптом это не лечится — лечится одним проходом по
уже склеенному ролику:

```
ffmpeg -i concat.mp4 -vf "eq=saturation=0.95:contrast=1.04,colortemperature=temperature=5600" -c:a copy graded.mp4
```

Одна команда на весь ролик, а не по клипам — иначе выравнивать нечего.

И клипы надёжнее делать **image-to-video от кадров**, отрисованных из
общего базового кадра. Тогда совпадёт не только стиль, но и сама сцена: те
же доски, та же лампа, тот же домик на том берегу.

---

## Приёмка

1. Оба листа лежат рядом — персонажи из одного мира? Одна толщина контура,
   одна чернота, один свет слева
2. Котик из ключевого кадра рядом с `cat-open.png` — те же пять признаков?
3. Ключевой кадр уменьшить до ширины телефона — понятно, кто кого ловит?
4. Видео на паузе в трёх местах — персонаж не поплыл?

---

## Куда класть

```
art/video/cat-sheet.png       лист котика
art/video/spider-sheet.png    лист паука
art/video/keyframe-*.png      ключевые кадры под сюжеты
art/video/avatar.png          аватарка, мастер
```

Исходники в git не идут — `art/.gitignore`. Готовые ролики и сборки —
`ref_for_video/`.
