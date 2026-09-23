# Сюжеты роликов: короткие истории про карты

Формат канала: 20–30 секунд, четыре клипа Veo по 7–8 секунд, голос поверх.
Истории — про карты вообще, а не про игру; игра появляется только в конце
титром `cozyspider.ru`.

Персонажи по умолчанию — котик и паук у пруда
([VIDEO-CHARACTERS.md](VIDEO-CHARACTERS.md)). Но если история сама по себе
кинематографична, играется она, а маскоты уходят на второй план: в сюжете
№2 в кадре живой король, а котик появляется как его кот. Мир держит не
пруд, а техника и свет — один тёплый источник, холодное всё остальное,
живописная среда и плоская графика на персонажах.

## Как собирается любой сюжет

1. Текст диктора — восемь коротких строк, по две на кадр
2. Четыре кадра, **одно действие на кадр**
3. Промпт = блок стиля из [VIDEO-CHARACTERS.md](VIDEO-CHARACTERS.md)
   дословно + `CHARACTERS` + `ACTION` + `CAMERA` + `MOTION` + `AUDIO`
4. Голос — отдельным WAV, см. [VIDEO-VOICE.md](VIDEO-VOICE.md). В промпте
   всегда `no speech, no dialogue, ambient sound only`
5. Грейд одной командой по склеенному ролику, не по клипам

**Если гоните image-to-video** от общего базового кадра (надёжнее по
совпадению сцены) — абзац `CHARACTERS` из промпта убрать целиком.
Внешность несёт картинка, описание словами модель читает как разрешение
перерисовать.

---

## 1. Туз пик

Почему туз пик — самая нарядная карта в колоде. Ответ: он был налоговой
маркой, а узор на нём — защита от подделки, как на деньгах.

Фактура: пошлина введена актом 1711 года (действует с 1712), с 1765-го туз
пик печатает сама Stamp Office, отменено в 1960-м. Казнь Ричарда Хардинга
в 1805-м за подделку такого туза — часто цитируемый случай, первоисточник
не проверен: в тексте на нём не настаивать.

**Осторожно с крючком «посмотри на туз пик».** Нарядный туз пик — традиция
англо-американских колод (Bicycle, Bee). В русской атласной колоде
клеймёный туз другой — **бубновый**: с 1819 года на нём стояло клеймо
Императорского воспитательного дома, оно же опознавало карты русской
выделки. Зритель с атласной колодой в руках посмотрит на туз пик и не
увидит ничего особенного. Либо менять первую строку на «возьми любую
американскую колоду», либо снимать русскую версию сюжета — она в очереди
под номером 13 и для VK с Дзеном сильнее.

И не резать на этой истории геймплей: туз пик в игре — капля на листе
(`faces/S1.webp`), никаких вензелей на нём нет.

### Текст диктора

Строчными, без знаков — правило серии.

| Кадр | Строки |
|---|---|
| 1 | `посмотри на туз пик` · `он всегда самый нарядный в колоде` |
| 2 | `кажется что так решил художник` · `а дело в налоге` |
| 3 | `триста лет назад в англии с карт брали пошлину` · `и туз пик печатало государство вместо квитанции` |
| 4 | `узор делали сложным чтобы никто не повторил` · `налог отменили а туз так и остался нарядным` |

### Ловушка: карты

Veo рисует на картах кашу вместо знаков. Поэтому в промптах карты описаны
нарочито бедно — кремовое поле и один крупный чёрный пик, без букв и цифр.
Настоящий туз из игры вставляется в монтаже поверх, если понадобится
читаемая карта.

### Кадр 1 — раскладка

```
Style: hand-painted 2D cel animation, cozy Japanese animated film look.
Vertical 9:16.

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

CHARACTERS: a small black cat with a rounded silhouette, head almost as
large as the body, short legs, huge round white eyes, large triangular ears
with flat pale lavender inner shapes. Beside it a tiny round black spider
the size of a plum, flat matte black with a slightly ragged soft edge,
eight short springy legs with curled tips, two big round white eyes with
small black pupils and four small white dots above them, no mouth.

ACTION: a few playing cards lie face up on the wet planks beside the
lantern. The cat gently slides one card with its paw into the pool of warm
light — a plain cream card with one large black spade on it. The spider sits
at the edge of the plank and leans in to look.

CAMERA: locked off, very slow push-in on the lit card.

MOTION: slow and calm. Rain is the only quick element in frame. The lantern
flame breathes and flickers, and its reflection on the wet wood flickers
with it. Reeds sway slightly. Limited cel animation, the characters animate
as flat shapes and never gain fur, volume or realistic animal anatomy.

The playing cards stay simple: plain cream faces, one large black spade
shape, no letters, no numbers, no readable print.

AUDIO: ambient only — steady rain on wood, faint water, distant night.
No speech, no dialogue, no voiceover, no music.
```

### Кадр 2 — котик рассматривает узор

Блок стиля тот же, дословно. Меняются только три абзаца:

```
ACTION: the cat holds the card upright in both front paws and tilts it
toward the lantern flame. The ornament inside the black spade catches the
warm light and glints. The spider climbs onto the cat's paw and reaches one
leg toward the curling pattern.

CAMERA: slow push-in from medium to a close-up of the card.

MOTION: slow and calm, only the card tilts and the spider's leg moves. Rain
is the only quick element in frame. The flame and its reflection flicker
together. Limited cel animation, characters stay flat shapes.
```

### Кадр 3 — печать

```
ACTION: high angle on the wet planks. A neat stack of plain cards with a
single small copper coin resting on top. The cat presses a small brass
stamp down onto the card with the black spade and lifts it, leaving a dark
red wax mark. The spider leans over the mark, curious.

CAMERA: locked off, high angle looking down at the planks, slight push-in.

MOTION: one single press of the stamp, nothing else moves except rain, the
flame and its reflection on the wood. Limited cel animation, characters
stay flat shapes.
```

### Кадр 4 — узор и уход

```
ACTION: macro on the card. The spider walks slowly along the curling
ornament inside the black spade, its short legs following the curves, and
settles in the middle of the spade. Rain dots the card. The cat's silhouette
watches from the soft background.

CAMERA: very slow pull-back from macro to medium, ending on the card alone
in the lantern light.

MOTION: slow and calm. Rain is the only quick element in frame. The flame
and its reflection flicker together. Limited cel animation, the spider stays
a flat shape and never gains fur or volume.
```

### Приёмка

1. Четыре клипа подряд без звука — один ли это стол, одна ли лампа?
2. Карта нигде не пытается показать буквы?
3. Паук нигде не оброс шерстью и не стал страшным?
4. Голос лёг в тайминг: две строки на клип, конец строки до склейки

---

## 2. Карты для Карла VI

Карты как то, чем человека успокаивают. Главный сюжет серии: он объясняет,
зачем вообще нужна игра, и не требует ни одного факта про колоду.

**Это единственный сюжет не у пруда.** Действие в покоях короля, персонажи
тоже другие — живой человек, а не маскоты. Мир держится не прудом, а
техникой и светом: одна тёплая свеча слева, всё остальное холодное,
живописная среда, плоская графика на персонажах. Котик — канонический, он
здесь кот короля и появляется в трёх кадрах из четырёх. Паука нет.

**Дождя нет.** Вместо него пылинки в тёплом луче и дым от свечи. Всё
остальное из канона остаётся дословно.

Фактура: приступы безумия у Карла VI начались в августе 1392-го;
«стеклянный бред» — боязнь разбиться — за ним записан. Запись в дворцовых
счетах того же года настоящая: художнику Жакмену Грингоннёру заплачено 56
парижских су за три колоды карт, золочёных и расписанных, «для развлечения
короля».

**Чего говорить нельзя.** «Карты придумали, чтобы вылечить безумного
короля» — легенда XIX века. Карты расползлись по Европе на двадцать лет
раньше (первые упоминания — 1370-е), и запись не говорит ни о лечении, ни
об изобретении. Честная формулировка: одна из самых ранних записей о картах
в Европе — про то, как ими кого-то успокаивали. Эмоция та же, вранья нет.

### Текст диктора, 28 секунд

Знаки препинания нужны: озвучка идёт в CapCut, он держит по ним паузы.
Правило «строчными и без знаков» — только для Veo и Flow.

| Кадр | Секунды | Текст |
|---|---|---|
| 1 | 0–6 | В тысяча триста девяносто втором году король Франции сошёл с ума. Он перестал узнавать жену. |
| 2 | 6–13 | А в плохие дни думал, что сделан из стекла, и не давал к себе подойти. |
| 3 | 13–20 | В дворцовых счетах за тот год есть строчка: художнику заплатили за три колоды золочёных карт для короля. |
| 4 | 20–28 | Это одна из самых ранних записей о картах в Европе. И она про то, как человека успокаивали. |

Год диктору писать словами — «тысяча триста девяносто втором», иначе часть
движков читает его как набор цифр.

### Блок стиля — дворцовая версия

Вставляется дословно в начало каждого из четырёх промптов, без единого
изменённого слова. Отличия от прудового блока: другой источник света
(свеча вместо лампы), нет дождя, добавлен человек как отдельный тип
персонажа.

```
Style: hand-painted 2D cel animation, cozy Japanese animated film look.
Vertical 9:16.

The HUMAN CHARACTERS are cel-animated: clean confident ink outline, flat
gouache fill, minimal soft watercolour shading, simple expressive faces,
no realistic skin texture, no photographic detail.

THE CAT is flat graphic animation — a solid matte black silhouette, clean
even ink edges, no fur texture, no shading or gradient on the body, flat
pale lavender ear shapes, thin white whisker lines, huge round white eyes
with small black pupils.

The ENVIRONMENT is fully painted — gouache and watercolour texture, visible
brushwork on old stone, worn wood, heavy wool and tapestry.

Light: ONE warm source, a single candle or small oil lamp low on the left.
It is the only saturated colour in frame. Everything else stays cool — deep
indigo shadows, cold grey-blue stone, muted slate and dusty green fabric —
with a narrow band of warm light spilling across the floor and small warm
lit windows far away across a dark courtyard. Faint warm rim light on the
left edge of the characters, cool blue fill everywhere else.

Atmosphere: fine dust motes drifting slowly through the warm light, a thin
ribbon of smoke rising from the candle, soft bloom around the flame and the
distant windows, gentle film grain.

Depth: three clear planes — dark out-of-focus furniture across the bottom
foreground, the sharp lit subject in the middle, a soft blurred chamber and
window behind. Shallow depth of field.

Period: France, end of the fourteenth century. Bare stone chamber, heavy
dark wooden furniture, a worn tapestry, fur and wool throws, candles. No
modern objects anywhere.

THE KING, identical in every shot: a thin pale young man, shoulder-length
dark hair, clean-shaven, a plain thin gold circlet, a long muted deep-blue
robe with worn fur trim. Tired, gentle, never frightening.

Mood: quiet, warm, unhurried, faintly melancholic. Nothing threatening.
```

### Кадр 1 — он не узнаёт её

```
ACTION: a dim stone chamber at night. The king sits on the edge of a great
bed, shoulders low, staring at nothing. A young woman in a long pale gown
stops in the doorway holding a candle and says nothing. He lifts his eyes to
her, looks at her as at a stranger, and slowly turns his face away. The
small black cat sits on the floor between them and watches him.

CAMERA: locked off, wide shot, the king small in the frame, very slow
push-in.

MOTION: slow and calm. Only the head turning, the candle flame breathing and
the dust drifting. Limited cel animation. The cat stays a flat black shape
and never gains fur, volume or realistic animal anatomy.

AUDIO: ambient only — a low fire, a candle, a quiet stone room, faint wind
far away. No speech, no dialogue, no voiceover, no music.
```

### Кадр 2 — стекло

```
ACTION: close on the king wrapped in a fur throw, sitting very still. He
raises one thin hand in front of the candle flame and studies it; the edges
of his fingers glow translucent amber, as if the light passed through them.
A servant's hand reaches toward his shoulder from the right and he flinches
away from it without looking, pressing back into the chair.

CAMERA: slow push-in to a close-up of the hand against the flame, shallow
focus, the face soft behind it.

MOTION: almost nothing moves — the hand, one flinch, the flame and the dust.
Limited cel animation, flat shapes, no realistic skin texture.

AUDIO: ambient only — a candle, a quiet stone room, a distant hall. No
speech, no dialogue, no voiceover, no music.
```

### Кадр 3 — художник пишет карты

```
ACTION: a warm cluttered workshop table. A painter in a simple dark tunic
holds a fine brush and lays gold leaf onto a small rectangular card; six
finished cards lie drying in a row beside a shell of gold, a mortar of
pigment and a heavy ledger with a quill. The small black cat sits at the
edge of the table and follows the brush with its eyes.

CAMERA: high angle looking down at the table, locked off, very slow
push-in on the cards.

MOTION: one continuous stroke of the brush, then the cat's head turning.
Nothing else moves except the flame and the dust. Limited cel animation.

The playing cards stay simple: plain cream faces with a thin gold edge and
one simple dark shape, no letters, no numbers, no readable print.

AUDIO: ambient only — a candle, soft brush strokes, a quiet workshop. No
speech, no dialogue, no voiceover, no music.
```

### Кадр 4 — покой

```
ACTION: the king sits at a small table in the candlelight and lays the
painted cards out in neat overlapping rows, unhurried, one card at a time.
His shoulders have come down and his face is calm for the first time. The
small black cat is curled asleep on the table beside his hand.

CAMERA: very slow pull-back from the cards to a wide view of the chamber,
the candle and the dark window, leaving empty space in the lower third of
the frame.

MOTION: slow and calm, one card placed at a time. Only the flame, the smoke
and the dust move. Limited cel animation. The cat stays a flat black shape.

The playing cards stay simple: plain cream faces with a thin gold edge and
one simple dark shape, no letters, no numbers, no readable print.

AUDIO: ambient only — a candle, a low fire, a quiet stone room at night. No
speech, no dialogue, no voiceover, no music.
```

Пустой низ кадра в четвёртом клипе — под титр `cozyspider.ru`.

### Приёмка

1. Король в четырёх клипах — один и тот же человек? Обруч, волосы, синий
   плащ. Если поплыл, гнать image-to-video от одного базового кадра
2. Лицо в первом кадре читается пустым, а не злым? Ничего страшного в
   ролике быть не должно
3. Карты нигде не пытаются показать буквы и цифры?
4. Котик не оброс шерстью и не стал объёмным
5. Голос уложился в 28 секунд: по строке на клип, конец фразы до склейки

---

## Очередь сюжетов

Готовые тексты — в переписке, сюда переносятся по мере съёмки.

| | Сюжет | Статус |
|---|---|---|
| 1 | Туз пик и налог | раскадровка есть |
| 2 | Карты для Карла VI, 1392 — чем человека успокаивают | раскадровка есть |
| 3 | Пасьянс это «терпение», в Скандинавии «кабала» — гадание, а не игра | текст |
| 4 | Таро сначала было игрой, мистику приписали в 1781-м | текст |
| 5 | Король червей — самоубийца по ошибке копииста | текст |
| 6 | Колода, складывающаяся в карту побега, ВМВ | текст |
| 7 | Карточные деньги Квебека, 1685 | текст |
| 8 | Solitaire в Windows — урок мышки, а не игра | текст |
| 9 | Прообраз «Пиковой дамы»: Голицын и Сен-Жермен | текст |
| 10 | Сэндвич графа Сэндвича | текст |
| 11 | Nintendo сто лет делала карты | текст |
| 12 | Солдатская колода вместо молитвенника | текст, легенда |
| 13 | Туз бубён: клеймо воспитательного дома, пеликан, карточный налог на сирот | текст, русская версия №1 |
