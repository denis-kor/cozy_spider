/**
 * Короткие звуки колоды: случайный из набора, без повтора подряд.
 *
 * Один и тот же «ква» на каждой раздаче к десятой надоедает — ухо ловит
 * повтор быстрее глаза. Поэтому набор из нескольких вариантов, и следующий
 * всегда отличается от предыдущего.
 *
 * HTMLAudioElement, а не Web Audio: звуков три, длиной в полсекунды, и
 * играются они только по нажатию — этого хватает, а мобильный Safari
 * пускает такой звук без отдельной разблокировки контекста.
 */
export class SoundSet {
  private clips: HTMLAudioElement[]
  private last = -1

  constructor(urls: string[], private volume = 0.55) {
    this.clips = urls.map((url) => {
      const audio = new Audio(url)
      audio.preload = 'auto'
      return audio
    })
  }

  play(): void {
    if (this.clips.length === 0) return
    let i = Math.floor(Math.random() * this.clips.length)
    if (this.clips.length > 1 && i === this.last) i = (i + 1) % this.clips.length
    this.last = i

    // Клон — чтобы быстрые раздачи подряд не обрывали друг друга.
    const audio = this.clips[i].cloneNode() as HTMLAudioElement
    audio.volume = this.volume
    // Звук — украшение: заблокированный автоплей или сбой сети игре не мешают.
    audio.play().catch(() => {})
  }
}
