import { mountAccount } from './app/account'
import { mountHud } from './app/hud'
import { resolvePacks } from './app/packs'
import { ServerAdapter } from './app/platform/server'
import { mountRadio } from './app/radio'
import { mountShop } from './app/shop'
import { mountStart } from './app/start'
import { showWinPlaque } from './app/winPlaque'
import { readLocalMetrics } from './app/track'
import { Stage } from './engine/Stage'
import { MOODS } from './engine/scene/Ambience'

/**
 * Запуск обёрнут в функцию, а НЕ выполняется top-level await'ом.
 *
 * В прод-бандле ядро Pixi лежит в одном чанке с этим модулем. Внутри
 * `app.init` Pixi динамически импортирует чанк окружения (browserAll),
 * который сам импортирует ядро из нашего чанка. Если модуль стоит на
 * top-level await, чанк не довыполнен, и загрузка окружения ждёт его
 * вечно: дедлок без единой ошибки в консоли. В деве не воспроизводится —
 * там модули не бандлятся и цикла не возникает.
 */
async function main(): Promise<void> {
  const host = document.getElementById('stage')!
  const hud = document.getElementById('hud')!
  const debug = document.getElementById('debug')!
  const boot = document.getElementById('boot')!
  const bootBar = boot.querySelector<HTMLElement>('.bar i')!

  const stage = new Stage()

  // Платформа — до сцены: применённый пак сверяется с энтайтлментами.
  // ServerAdapter деградирует в localStorage без сети, так что старт
  // это не задержит дольше, чем на неудавшийся fetch.
  const platform = new ServerAdapter()
  await platform.init()

  // Дебаг-режим (?debug на проде, в деве всегда — та же логика, что у
  // панели в hud.ts) открывает все паки: удобно смотреть сцены и колоды
  // без покупки. Осознанно читерская ручка: паки — косметика, их ассеты
  // и так лежат в открытую (§ PAID-PACKS), а «покупкой» это не считается —
  // на сервер ничего не пишется, права живут до закрытия вкладки.
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    const real = platform.getEntitlements.bind(platform)
    platform.getEntitlements = async () => {
      const owned = await real()
      try {
        const catalog = (await fetch('/assets/shop.json', { cache: 'no-cache' }).then((r) =>
          r.json(),
        )) as { skus: { id: string }[] }
        for (const sku of catalog.skus) owned.add(sku.id)
      } catch {
        // Каталог не загрузился — остаёмся с честными правами.
      }
      return owned
    }
  }

  const { sceneUrl, deckUrl } = resolvePacks(await platform.getEntitlements())

  await stage.init({
    host,
    sceneUrl,
    commonUrl: '/assets/scene/common',
    deckUrl,
    suits: 1,
    onProgress: (done, total) => {
      if (!total) return
      // Первый же честный прогресс снимает «дыхание» ожидания манифестов.
      boot.classList.remove('idle')
      bootBar.style.width = `${Math.min(100, (done / total) * 100)}%`
    },
  })

  // Сцена готова — заставка растворяется и через полсекунды уходит из DOM.
  boot.classList.add('done')
  setTimeout(() => boot.remove(), 600)

  // HUD первым: он пишет root.innerHTML и снёс бы всё, смонтированное раньше.
  let shop: ReturnType<typeof mountShop> | undefined
  let start: ReturnType<typeof mountStart> | undefined
  let account: ReturnType<typeof mountAccount> | undefined
  // Победа — намеренно просто и неубиваемо: карты слетаются в лоток и
  // веером тают, в сцене играет салют/звездопад с котиком, в момент
  // веера экран озаряет тёплая CSS-вспышка, затем плашка с действиями.
  // Плашка обязательна: стол пуст, без неё игрок остался бы перед
  // сценой без игры.
  stage.onCelebrate = () => {
    stage.table.flyAwayAll()
    setTimeout(() => {
      const flash = document.createElement('div')
      flash.className = 'win-flash'
      document.body.appendChild(flash)
      setTimeout(() => flash.remove(), 2600)
    }, 1400)
    setTimeout(() => {
      showWinPlaque({
        onPlayAgain: () => stage.table.newGame((Math.random() * 0x7fffffff) | 0),
        onMenu: () => start?.open(),
      })
    }, 3000)
  }

  mountHud(stage, hud, { onShop: () => shop?.open(), onMenu: () => start?.open() })
  shop = mountShop(hud, platform)
  account = mountAccount(hud, platform, {
    onShop: () => shop?.open(),
    // После выхода титульник должен показать гостя, а не старое имя.
    onSignedOut: () => start?.open(),
  })
  start = mountStart(hud, platform, {
    onAccount: () => account?.open(),
    onShop: () => shop?.open(),
  })
  mountRadio(stage)

  // Игра встречает титульным экраном; сцена уже живёт и просвечивает позади.
  start.open()

  // Ручка для отладки из консоли: настройки атмосферы удобнее крутить вживую,
  // чем пересобирать. В прод не попадёт — Vite вырежет ветку по DEV.
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__stage = stage
    w.__pixi = await import('pixi.js')
    w.__metrics = readLocalMetrics
    // Запись канваса в webm по хоткею R — сырьё для роликов.
    const { mountRecorder } = await import('./app/record')
    mountRecorder(stage)
  }

  // Переключение станции — оно же смена настроения всей сцены (§7 дока).
  const moodIds = Object.keys(MOODS)
  let moodIndex = 0

  window.addEventListener('keydown', (e) => {
    // Ctrl+Z / Cmd+Z — отмена хода. Учитываем русскую раскладку: там на
    // той же клавише живёт «я». preventDefault, чтобы браузер не пытался
    // откатывать свои поля ввода.
    if ((e.ctrlKey || e.metaKey) && ['z', 'Z', 'я', 'Я'].includes(e.key)) {
      e.preventDefault()
      stage.table.undo()
      return
    }
    if (e.key === 'm' || e.key === 'ь') {
      moodIndex = (moodIndex + 1) % moodIds.length
      stage.ambience.setMood(moodIds[moodIndex])
    }
    if (e.key === 'd' || e.key === 'в') {
      debug.classList.toggle('show')
    }
  })

  setInterval(() => {
    const a = stage.ambience
    debug.textContent =
      `fps      ${stage.fps.toFixed(0)}\n` +
      `tier     ${stage.currentTier}\n` +
      `станция  ${a.mood.id}   [M] сменить\n` +
      `flicker  ${a.flicker.toFixed(2)}\n` +
      `gust     ${a.gust.toFixed(2)}`
  }, 250)
}

void main().catch((err) => {
  // Заставка остаётся на экране, но перестаёт врать, что грузится.
  console.error(err)
  const boot = document.getElementById('boot')
  boot?.classList.remove('idle')
  const label = boot?.querySelector('span')
  if (label) label.textContent = 'не загрузилось — обнови страницу (Ctrl+F5)'
})
