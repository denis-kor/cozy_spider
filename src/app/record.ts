import type { Stage } from '../engine/Stage'

/**
 * Дев-запись канваса в webm для нарезки роликов. Хоткей R (К) — старт/стоп,
 * файл сам скачивается по окончании.
 *
 * Пишем именно `app.canvas` через captureStream: в кадр попадает ровно то,
 * что видит игрок — сцена и карты, без HUD (он DOM поверх) и без запаса
 * сцены под параллакс, который отдал бы renderer.extract (§17.4).
 */
export function mountRecorder(stage: Stage): void {
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []

  // Индикатор — DOM, в запись не попадает.
  const dot = document.createElement('div')
  dot.style.cssText =
    'position:fixed;top:10px;right:10px;width:12px;height:12px;border-radius:50%;' +
    'background:#e33;box-shadow:0 0 8px #e33;z-index:9999;display:none;' +
    'animation:rec-blink 1s step-end infinite'
  const style = document.createElement('style')
  style.textContent = '@keyframes rec-blink{50%{opacity:.25}}'
  document.head.appendChild(style)
  document.body.appendChild(dot)

  const start = (): void => {
    const canvas = stage.app.canvas as HTMLCanvasElement
    const streamCanvas = canvas.captureStream(60)
    // vp9 заметно чище на градиентах сцены; старые браузеры откатятся на vp8.
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    chunks = []
    recorder = new MediaRecorder(streamCanvas, {
      mimeType: mime,
      // Битрейт с запасом: это сырьё под монтаж, ужмётся при экспорте ролика.
      videoBitsPerSecond: 20_000_000,
    })
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `cozy-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      dot.style.display = 'none'
      recorder = null
    }
    recorder.start()
    dot.style.display = 'block'
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'r' && e.key !== 'R' && e.key !== 'к' && e.key !== 'К') return
    if (e.ctrlKey || e.metaKey) return
    if (recorder) recorder.stop()
    else start()
  })
}
