import { applyPack, isApplied } from './packs'
import type { PlatformAdapter, Sku } from './platform/types'
import { track } from './track'

/**
 * Витрина. Сейчас — fake-door тест (§10): пак существует как карточка с
 * ценой, нажатие «Купить» считается, денег не берётся. Так выясняется,
 * хотят ли люди платить за вторую сцену, ДО того как она нарисована и
 * до всей юридики с кассой.
 *
 * Витрина ничего не знает про fake-door: она зовёт `adapter.purchase` и
 * показывает результат. Когда за адаптером появится настоящая ЮKassa,
 * этот файл не изменится ни строчкой.
 */

/**
 * Остаток приветственного часа человеческим текстом.
 *
 * Пока триал длился сутки, хватало статичной подписи «первый день
 * бесплатно». На часе она стала бы враньём: у игрока может остаться три
 * минуты, а надпись обещает час. Таймер не заводим — строка считается в
 * момент отрисовки, а лавку и профиль и так перерисовывают при открытии.
 */
export function trialLeft(until?: number): string {
  if (!until) return 'бесплатно'
  const left = until - Math.floor(Date.now() / 1000)
  if (left <= 60) return 'бесплатно, меньше минуты'
  return `бесплатно ещё ${Math.ceil(left / 60)} мин`
}

interface CatalogSku {
  id: Sku
  kind: 'scene' | 'deck'
  title: string
  desc: string
  price: number
  /** Сцена: картинка-баннер сцены для миниатюры карточки. */
  thumb?: string
  /** Колода: база папки колоды, из неё берётся веер карт в миниатюре. */
  deck?: string
  /** Колода: какие лица разложить веером в миниатюре (первым обычно 'back'). */
  fan?: string[]
  /** Колода: какие лица «раскрыть» в лайтбоксе по лупе (по одной карте). */
  cards?: string[]
  /** Колода: запасная картинка-сетка для лайтбокса, если нет списка `cards`. */
  preview?: string
}

interface Catalog {
  currency: string
  skus: CatalogSku[]
}

// Значки поверх миниатюры — визуальные метки вместо текстовых бейджей.
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>'
const ICON_LOUPE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>'

export interface Shop {
  open(): void
}

export interface ShopHooks {
  /** Открыть вход в аккаунт (титульник). Кнопка «войдите» ведёт сюда сама. */
  onSignIn?: () => void
}

/**
 * Веер из настоящих карт для миниатюры колоды. Первым в списке обычно 'back'
 * (рубашка), дальше — несколько лиц; они раскладываются симметрично от центра.
 */
function buildFan(el: HTMLElement, base: string, faces: string[]): void {
  const mid = (faces.length - 1) / 2
  faces.forEach((face, i) => {
    const img = document.createElement('img')
    img.src = face === 'back' ? `${base}/back.webp` : `${base}/faces/${face}.webp`
    img.alt = ''
    const k = i - mid
    img.style.transform = `rotate(${k * 8}deg) translateX(${k * 30}px) translateY(${Math.abs(k) * 7}px)`
    img.style.zIndex = String(10 - Math.abs(k))
    el.appendChild(img)
  })
}

export function mountShop(root: HTMLElement, adapter: PlatformAdapter, hooks: ShopHooks = {}): Shop {
  // `over-start`: лавку можно открыть и с титульного экрана — она обязана
  // лечь поверх него, а не под (z-index 40 против 30, см. index.html).
  const overlay = document.createElement('div')
  overlay.className = 'shop-overlay over-start'
  overlay.innerHTML = `
    <div class="shop-panel" role="dialog" aria-label="Магазин">
      <div class="shop-head">
        <span class="shop-title">Лавка</span>
        <button class="shop-close" data-close aria-label="Закрыть">✕</button>
      </div>
      <div class="shop-list" data-list>Загрузка…</div>
      <div class="shop-note">Базовая игра бесплатная, колоды и сцены можно докупать.
        Оплата — через ЮKassa, <a href="/oferta.html" target="_blank">условия покупки</a>.</div>
    </div>
  `
  root.appendChild(overlay)

  const list = overlay.querySelector('[data-list]') as HTMLElement

  // Данные витрины кэшируем, чтобы «Применить» перерисовывал её без ре-фетча.
  let catalog: Catalog | null = null
  let owned: Set<Sku> = new Set()
  // Паки, открытые приветственным триалом. Живут отдельно от owned: триал
  // не покупка, и смешивать их нельзя (см. paint).
  let trialSkus: Set<Sku> = new Set()
  // Было ли что-то применено за визит: тогда закрытие лавки перезагрузит
  // страницу, чтобы выбор вступил в игру (§ PAID-PACKS).
  let dirty = false

  async function render(): Promise<void> {
    const [cat, own] = await Promise.all([
      fetch('/assets/shop.json', { cache: 'no-cache' }).then((r) => r.json() as Promise<Catalog>),
      adapter.getEntitlements(),
    ])
    catalog = cat
    owned = own
    // Триал доступен только после getEntitlements — он его и кеширует.
    trialSkus = new Set(adapter.getTrial?.()?.skus ?? [])
    paint()
  }

  function paint(): void {
    if (!catalog) return
    list.innerHTML = ''

    // Две колонки с заголовками: слева сцены, справа колоды.
    const columns: Record<CatalogSku['kind'], HTMLElement> = {
      scene: document.createElement('div'),
      deck: document.createElement('div'),
    }
    columns.scene.className = 'shop-col'
    columns.deck.className = 'shop-col'
    columns.scene.innerHTML = '<h3 class="shop-col-head">Сцены</h3>'
    columns.deck.innerHTML = '<h3 class="shop-col-head">Колоды</h3>'

    for (const sku of catalog.skus) {
      const card = document.createElement('div')
      card.className = 'shop-card'

      // Триал ≠ покупка. `usable` — можно применить прямо сейчас (куплено,
      // бесплатно или открыто приветственным часом). `owns` — навсегда.
      // Их нельзя смешивать: иначе триальный пак прикинулся бы купленным и
      // спрятал путь покупки ровно в тот день, когда игрок им любуется.
      const onTrial = trialSkus.has(sku.id)
      const owns = sku.price === 0 || (owned.has(sku.id) && !onTrial)
      const usable = owns || onTrial
      const applied = usable && isApplied(sku.kind, sku.id)
      const price = sku.price === 0 ? 'бесплатно' : `${sku.price} ${catalog.currency}`

      // «Сейчас в игре» — не словом, а тёплым кантом вокруг карточки.
      if (applied) card.classList.add('shop-active')

      // Только название: тип читается по картинке, описание убрано ради тишины.
      card.innerHTML = `
        <div class="shop-thumb" data-thumb></div>
        <div class="shop-body">
          <b>${sku.title}</b>
          <div class="shop-actions" data-actions></div>
        </div>
      `

      // Миниатюра: у сцены — баннер сцены, у колоды — веер настоящих карт.
      const thumb = card.querySelector('[data-thumb]') as HTMLElement
      if (sku.kind === 'scene' && sku.thumb) {
        const img = document.createElement('img')
        img.className = 'shop-scene'
        img.src = sku.thumb
        img.alt = ''
        thumb.appendChild(img)
      } else if (sku.kind === 'deck' && sku.deck && sku.fan) {
        const fan = document.createElement('div')
        fan.className = 'shop-fan'
        buildFan(fan, sku.deck, sku.fan)
        thumb.appendChild(fan)
      }

      // Крупный просмотр: у колоды — раскрытие карт, у сцены — большой кадр.
      // Открывается и значком-лупой, и тапом по самой миниатюре.
      if (sku.cards?.length || sku.preview) {
        thumb.classList.add('shop-thumb-tap')
        thumb.addEventListener('click', () => openPreview(sku))
        const peek = document.createElement('button')
        peek.className = 'shop-peek'
        peek.setAttribute(
          'aria-label',
          sku.kind === 'scene' ? 'Посмотреть сцену крупнее' : 'Посмотреть колоду',
        )
        peek.innerHTML = ICON_LOUPE
        peek.addEventListener('click', (e) => {
          // Лупа внутри миниатюры: гасим всплытие, чтобы не открыть дважды.
          e.stopPropagation()
          openPreview(sku)
        })
        thumb.appendChild(peek)
      }
      if (applied) {
        // Медальон ✓ — только у пака, который сейчас в игре.
        const medal = document.createElement('span')
        medal.className = 'shop-medallion'
        medal.setAttribute('aria-label', 'Сейчас в игре')
        medal.innerHTML = ICON_CHECK
        thumb.appendChild(medal)
      }
      if (!owns && sku.price > 0) {
        // Не принадлежит навсегда — подпись прямо на картинке. На триале это
        // не ценник, а остаток приветственного часа: настоящую цену игрок
        // увидит на кнопке «Оставить». Медальон в другом углу, не спорят.
        const tag = document.createElement('span')
        tag.className = onTrial ? 'shop-pricetag shop-price-trial' : 'shop-pricetag'
        tag.textContent = onTrial ? trialLeft(adapter.getTrial?.()?.until) : price
        thumb.appendChild(tag)
      }
      // Куплен, но не в игре — миниатюра чистая; ниже кнопка «Применить».

      const actions = card.querySelector('[data-actions]') as HTMLElement

      if (usable && !applied) {
        // Доступен сейчас (куплен, бесплатный или на триале), но не «в игре» —
        // предложить применить. Смена сцены/колоды — перезагрузка
        // (§ PAID-PACKS): выгружать и грузить текстуры Pixi вживую не стоит.
        const action = document.createElement('button')
        action.textContent = 'Применить'
        action.onclick = () => {
          applyPack(sku.kind, sku.id)
          track('pack_apply', { sku: sku.id })
          // Не перезагружаем: выбор копится в лавке. Перерисовываем состояние
          // (медальон/кант/кнопки переезжают на новый выбор), а реальное
          // применение — при закрытии лавки (dismiss → reload).
          dirty = true
          paint()
        }
        actions.appendChild(action)
      }

      if (!owns && sku.price > 0) {
        // Не принадлежит навсегда — покупка. Обычно цена уже на картинке, и на
        // кнопке только действие. На триале это тихая вторичная «Оставить ·
        // цена»: давить незачем, пак и так открыт, но путь оставить его себе
        // обязан быть виден именно сейчас — часа хватит ровно на то, чтобы
        // понять, нравится ли.
        const action = document.createElement('button')
        if (onTrial) {
          action.className = 'shop-keep-btn'
          action.textContent = `Оставить · ${price}`
        } else {
          action.className = 'shop-buy'
          action.textContent = 'Купить'
        }
        action.onclick = async () => {
          action.disabled = true
          const result = await adapter.purchase(sku.id)
          if (result.status === 'unavailable') {
            // Честный ответ fake-door: намерение записано, денег не взяли.
            action.textContent = 'Готовится — спасибо!'
            action.classList.add('shop-noted')
          } else if (result.status === 'signin-required') {
            // Покупка живёт в аккаунте — иначе её не перенести на другое
            // устройство и не вернуть после чистки браузера. Кнопка сама
            // ведёт ко входу: «идите в меню» тестеры читали как тупик.
            action.textContent = 'Войти и купить'
            action.disabled = false
            action.onclick = () => {
              close()
              hooks.onSignIn?.()
            }
          } else if (result.status === 'ok') {
            action.textContent = 'В игре'
          } else {
            action.disabled = false
          }
        }
        actions.appendChild(action)
      }
      // Куплен и в игре → без кнопок: активность показывают кант и медальон.

      columns[sku.kind].appendChild(card)
    }
    list.append(columns.scene, columns.deck)
  }

  // Лайтбокс поверх лавки (z-index 50 в index.html, над лавкой и титульником).
  // Колода «раскрывается» настоящими картами по одной; если списка карт нет —
  // показываем запасную картинку-сетку.
  function openPreview(sku: CatalogSku): void {
    track('deck_preview', { sku: sku.title })
    const box = document.createElement('div')
    box.className = 'shop-lightbox'
    box.innerHTML = `
      <button class="shop-lightbox-close" aria-label="Закрыть">✕</button>
      <figure class="shop-lightbox-fig">
        <div class="shop-lightbox-cards" data-cards></div>
        <figcaption>${sku.title}</figcaption>
      </figure>
    `
    const holder = box.querySelector('[data-cards]') as HTMLElement
    if (sku.deck && sku.cards?.length) {
      // Каждая карта раскрывается с задержкой по индексу — колода «веером».
      sku.cards.forEach((face, i) => {
        const img = document.createElement('img')
        img.className = 'shop-lb-card'
        img.src = `${sku.deck}/faces/${face}.webp`
        img.alt = ''
        img.style.transitionDelay = `${i * 55}ms`
        holder.appendChild(img)
      })
    } else if (sku.preview) {
      // Одиночная картинка (крупная сцена) — не сетка: центрируем по экрану.
      holder.classList.add('shop-lightbox-solo')
      const img = document.createElement('img')
      img.className = 'shop-lb-single'
      img.src = sku.preview
      img.alt = sku.title
      holder.appendChild(img)
    }

    const shut = (): void => {
      box.remove()
      window.removeEventListener('keydown', onKey, true)
    }
    // Escape ловим в фазе перехвата и глушим: иначе тот же Escape закрыл бы
    // и лавку под лайтбоксом.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        shut()
      }
    }
    box.addEventListener('click', (e) => {
      // Клик по фону или крестику закрывает; по самим картам — нет.
      const t = e.target as HTMLElement
      if (t === box || t.closest('.shop-lightbox-close')) shut()
    })
    window.addEventListener('keydown', onKey, true)
    root.appendChild(box)
    // Следующий кадр: класс .show запускает и появление фона, и раскрытие карт.
    requestAnimationFrame(() => box.classList.add('show'))
  }

  function close(): void {
    overlay.classList.remove('show')
  }

  // Пользователь закрыл лавку. Применяли что-то за визит — перезагрузка вводит
  // выбор в игру; ничего не меняли — просто закрываем без reload.
  function dismiss(): void {
    if (dirty) {
      location.reload()
      return
    }
    close()
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss()
  })
  ;(overlay.querySelector('[data-close]') as HTMLButtonElement).onclick = dismiss
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) dismiss()
  })

  return {
    open() {
      overlay.classList.add('show')
      track('shop_open')
      // Каждое открытие — свежая витрина: между визитами могла завершиться
      // покупка (вебхук, другой вкладкой) или смениться аккаунт.
      void render().catch(() => (list.textContent = 'Лавка не открылась — попробуйте позже'))
    },
  }
}
