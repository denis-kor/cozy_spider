import { mountAccount } from './app/account'
import { mountHud } from './app/hud'
import { resolvePacks } from './app/packs'
import { ServerAdapter } from './app/platform/server'
import { mountRadio } from './app/radio'
import { mountShop } from './app/shop'
import { mountStart } from './app/start'
import { mountViewport, requestFullscreenIfPossible } from './app/viewport'
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

  // Потеря WebGL-контекста (на телефоне — обычно нехватка видеопамяти):
  // показать человеку причину, а не немой чёрный экран.
  stage.onContextLost = () =>
    showFatal('Не хватило видеопамяти. Закройте другие вкладки и обновите страницу.')

  // Платформа — до сцены: применённый пак сверяется с энтайтлментами.
  // ServerAdapter деградирует в localStorage без сети, так что старт
  // это не задержит дольше, чем на неудавшийся fetch.
  const platform = new ServerAdapter()
  await platform.init()

  // Дев-режим открывает все паки: удобно смотреть сцены и колоды без покупки.
  // ТОЛЬКО в дев-сборке (Vite вырежет ветку по DEV) — на проде это была бы
  // лазейка «бесплатные платные паки по ?debug в адресе», поэтому на
  // деплой-сервере права честные. Ассеты паков и так лежат в открытую
  // (§ PAID-PACKS), но «покупкой» подмена не считается: на сервер ничего не
  // пишется, права живут до закрытия вкладки.
  if (import.meta.env.DEV) {
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

  // Полный экран и корректный поворот телефона: канвас держит весь вьюпорт,
  // а на смену ориентации ресайз подталкивается, пока iOS не устаканит размер.
  mountViewport(stage.app)

  // Взводим стартовую раздачу: пока сверху висит титульный экран, вся колода
  // ждёт стопкой в правом нижнем углу. По «Играть» она разлетится по столу.
  stage.table.armDeal()

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
        onPlayAgain: () => stage.table.newGame(),
        onMenu: () => start?.open(),
      })
    }, 3000)
  }

  mountHud(stage, hud, { onShop: () => shop?.open(), onMenu: () => start?.open() })
  // Кнопка «Войти и купить» в лавке закрывает витрину и открывает
  // титульник — там и живёт вход в аккаунт.
  shop = mountShop(hud, platform, { onSignIn: () => start?.open() })
  account = mountAccount(hud, platform, {
    onShop: () => shop?.open(),
    // После выхода титульник должен показать гостя, а не старое имя.
    onSignedOut: () => start?.open(),
  })
  start = mountStart(hud, platform, {
    onAccount: () => account?.open(),
    onShop: () => shop?.open(),
    // Полминуты приглашающего мигания «пуска» на кассетнике — от входа в
    // игру, а не от загрузки: сцена живёт и за титульником.
    onPlay: () => {
      // «Играть» — это жест: на телефоне/планшете можно уйти в полный экран
      // (где браузер это умеет). На iPhone Safari метода нет — тихо мимо.
      requestFullscreenIfPossible()
      stage.radio?.beginAttract()
      // Титул уходит — стол открывается стартовой раздачей из угла.
      stage.table.dealOutIfArmed()
    },
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

  // Единственный боевой хоткей — Ctrl+Z / Cmd+Z, отмена хода. Учитываем
  // русскую раскладку: там на той же клавише живёт «я». preventDefault,
  // чтобы браузер не пытался откатывать свои поля ввода.
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['z', 'Z', 'я', 'Я'].includes(e.key)) {
      e.preventDefault()
      stage.table.undo()
    }
  })

  // Дебаг-хоткеи и панель — ТОЛЬКО в дев-сборке. Vite вырежет ветку по DEV,
  // на деплой-сервер они не попадут. Раньше жили в проде без ограждения:
  // случайное 1/2 подменяло игроку партию съёмочным раскладом, m тихо менял
  // настроение всей сцены, d показывал служебную панель — обычному игроку
  // этого быть не должно.
  //
  //   1/2 — съёмочные расклады под совет «чужак у дна / в середине». Цифры
  //         в игре ни на что не завязаны и, в отличие от Ctrl+1/2 (их
  //         браузер забирает под вкладки), надёжно доходят до страницы.
  //   m   — переключить станцию, она же настроение всей сцены (§7 дока).
  //   d   — панель fps/tier/flicker.
  if (import.meta.env.DEV) {
    const moodIds = Object.keys(MOODS)
    let moodIndex = 0

    window.addEventListener('keydown', (e) => {
      // Пропускаем, когда фокус в поле ввода (логин по почте).
      const typingField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (!typingField && (e.code === 'Digit1' || e.code === 'Digit2')) {
        e.preventDefault()
        stage.table.loadDemo(e.code === 'Digit1' ? 'bottom' : 'middle')
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
}

/**
 * Показать фатальную ошибку прямо на заставке.
 *
 * На телефоне консоль недоступна, а немой чёрный экран не говорит ничего.
 * Поэтому причину пишем на самой заставке: сверху — человеческая строка,
 * снизу мелким — техническая деталь для диагностики.
 */
function showFatal(message: string, detail?: string): void {
  let boot = document.getElementById('boot')
  if (!boot) {
    boot = document.createElement('div')
    boot.id = 'boot'
    document.body.appendChild(boot)
  }
  boot.classList.remove('idle', 'done')
  const label = boot.querySelector('span')
  if (label) label.textContent = message
  else {
    const s = document.createElement('span')
    s.textContent = message
    boot.appendChild(s)
  }
  if (detail) {
    let small = boot.querySelector<HTMLElement>('.boot-detail')
    if (!small) {
      small = document.createElement('small')
      small.className = 'boot-detail'
      small.style.cssText =
        'margin-top:8px;max-width:80vw;color:#93a99b;font-size:11px;text-align:center;opacity:0.8;word-break:break-word'
      boot.appendChild(small)
    }
    small.textContent = detail
  }
}

void main().catch((err) => {
  // Заставка остаётся на экране, но перестаёт врать, что грузится, и
  // показывает саму ошибку — иначе на телефоне причину не увидеть.
  console.error(err)
  const detail = err instanceof Error ? err.message : String(err)
  showFatal('Не загрузилось — обновите страницу.', detail)
})
