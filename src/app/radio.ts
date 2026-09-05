import type { Stage } from '../engine/Stage'

/**
 * Радио в кассетнике: бесплатные lo-fi стримы.
 *
 * Контекст-док (§7) целится в собственный контент, и это остаётся планом.
 * Но пока своих треков нет, живое интернет-радио — рабочая заглушка того же
 * сорта, что процедурная графика вместо арта: игра звучит сегодня, а слой
 * заменяется целиком, не трогая актора.
 *
 * Живёт в `app`, а не в `engine`: это DOM-аудио (`HTMLAudioElement`), той же
 * природы, что HUD. `MediaElementSource` сюда не подключить — без CORS-
 * заголовков на стороне станции Web Audio отдаёт тишину, поэтому никакого
 * lowpass-микшера, просто элемент.
 */

interface Station {
  id: string
  /** Что светится на дисплее. Коротко: шрифт там 10 px. */
  title: string
  url: string
  /** Станция = настроение всей сцены (§7), а не только звук. */
  mood: string
}

/**
 * Прямые аудио-стримы, не веб-плееры: их можно скормить `<audio>` как есть.
 * Первая — на российском хостинге: до неё дотянется и тот, у кого
 * зарубежные станции режутся.
 */
const STATIONS: Station[] = [
  {
    id: 'record',
    title: 'record lo-fi',
    url: 'https://radiorecord.hostingradio.ru/lofi96.aacp',
    mood: 'rainyEvening',
  },
  {
    id: 'lautfm',
    title: 'laut.fm lofi',
    url: 'https://stream.laut.fm/lofi',
    mood: 'candles',
  },
  {
    id: 'soma',
    title: 'groove salad',
    url: 'https://ice1.somafm.com/groovesalad-128-mp3',
    mood: 'winterMorning',
  },
]

const STORE_KEY = 'cozy.radio.station'
const VOLUME = 0.55

export function mountRadio(stage: Stage): void {
  const radio = stage.radio
  if (!radio) return

  const audio = new Audio()
  audio.preload = 'none'
  audio.volume = VOLUME

  let index = Math.max(0, STATIONS.findIndex((s) => s.id === localStorage.getItem(STORE_KEY)))

  /** Игрок хочет звук. Отдельно от `audio.paused`: буферизация — это пауза без желания паузы. */
  let wantsSound = false

  /** Подряд идущие отказы станций. Полный круг без сигнала — сдаёмся, а не крутимся вечно. */
  let failures = 0

  let fadeTimer = 0

  const station = (): Station => STATIONS[index]

  radio.setLabel(station().title)

  /**
   * Каждый запуск — заново от `src`, а не `play()` после паузы.
   * Стрим не файл: после паузы элемент продолжает со старого места буфера,
   * догоняет живой край рывком или виснет. Перезаход даёт свежий эфир.
   */
  function tune(): void {
    clearInterval(fadeTimer)
    audio.volume = VOLUME
    audio.src = station().url
    radio!.setLabel('···')
    stage.ambience.setMood(station().mood)
    audio.play().catch(() => {
      // Сюда попадает и autoplay-блок, но у нас всегда есть жест —
      // значит, станция не отвечает. Ведём себя как при 'error'.
      onDead()
    })
  }

  function onDead(): void {
    if (!wantsSound) return
    failures += 1
    if (failures < STATIONS.length) {
      index = (index + 1) % STATIONS.length
      tune()
    } else {
      wantsSound = false
      radio!.playing = false
      radio!.setLabel('нет сигнала')
    }
  }

  /** Выключение без щелчка: короткий съезд громкости, потом стоп. */
  function switchOff(): void {
    wantsSound = false
    radio!.playing = false
    clearInterval(fadeTimer)
    fadeTimer = window.setInterval(() => {
      audio.volume = Math.max(0, audio.volume - VOLUME / 6)
      if (audio.volume === 0) {
        clearInterval(fadeTimer)
        audio.pause()
        // src сбрасываем, чтобы элемент не тянул стрим в фоне на паузе.
        audio.removeAttribute('src')
        audio.load()
      }
    }, 40)
  }

  audio.addEventListener('playing', () => {
    failures = 0
    radio!.playing = true
    radio!.setLabel(station().title)
  })
  audio.addEventListener('waiting', () => {
    if (wantsSound) radio!.setLabel('···')
  })
  audio.addEventListener('error', onDead)

  radio.onCommand = (command) => {
    if (command === 'toggle') {
      if (wantsSound) switchOff()
      else {
        wantsSound = true
        failures = 0
        tune()
      }
      return
    }

    // prev/next включают звук, даже если он был выключен: у настоящего
    // приёмника поиск станции и есть включение.
    index = (index + (command === 'next' ? 1 : -1) + STATIONS.length) % STATIONS.length
    localStorage.setItem(STORE_KEY, station().id)
    wantsSound = true
    failures = 0
    tune()
  }
}
