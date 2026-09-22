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

interface CatalogSku {
  id: Sku
  kind: 'scene' | 'deck'
  title: string
  desc: string
  price: number
  /** Картинка-витрина колоды: показывается по кнопке «Посмотреть» до покупки. */
  preview?: string
}

interface Catalog {
  currency: string
  skus: CatalogSku[]
}

const KIND_LABEL: Record<CatalogSku['kind'], string> = {
  scene: 'сцена',
  deck: 'колода',
}

export interface Shop {
  open(): void
}

export interface ShopHooks {
  /** Открыть вход в аккаунт (титульник). Кнопка «войдите» ведёт сюда сама. */
  onSignIn?: () => void
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
      <div class="shop-note">Базовая игра бесплатна навсегда. Паки — это новые настроения, не преимущество.
        Оплата — через ЮKassa, <a href="/oferta.html" target="_blank">условия покупки</a>.</div>
    </div>
  `
  root.appendChild(overlay)

  const list = overlay.querySelector('[data-list]') as HTMLElement

  async function render(): Promise<void> {
    const [catalog, owned] = await Promise.all([
      fetch('/assets/shop.json', { cache: 'no-cache' }).then((r) => r.json() as Promise<Catalog>),
      adapter.getEntitlements(),
    ])
    // Триал доступен только после getEntitlements — он его и кеширует.
    const trialSkus = new Set(adapter.getTrial?.()?.skus ?? [])

    list.innerHTML = ''
    for (const sku of catalog.skus) {
      const card = document.createElement('div')
      card.className = 'shop-card'

      // Триал ≠ покупка. `usable` — можно применить прямо сейчас (куплено,
      // бесплатно или открыто на первый день). `owns` — принадлежит навсегда.
      // Их нельзя смешивать: иначе триальный пак прикинулся бы купленным и
      // спрятал кнопку покупки ровно в тот день, когда игрок им любуется.
      const onTrial = trialSkus.has(sku.id)
      const owns = sku.price === 0 || (owned.has(sku.id) && !onTrial)
      const usable = owns || onTrial
      // Подпись-ценник: на триале — тихое «первый день бесплатно» без
      // таймера; настоящую цену игрок всё равно увидит на кнопке «Оставить».
      const priceTag = sku.price === 0 ? 'бесплатно' : onTrial ? 'первый день бесплатно' : `${sku.price} ${catalog.currency}`
      const realPrice = `${sku.price} ${catalog.currency}`

      card.innerHTML = `
        <div class="shop-card-top">
          <span class="shop-kind">${KIND_LABEL[sku.kind]}</span>
          <span class="shop-price${onTrial ? ' shop-price-trial' : ''}">${priceTag}</span>
        </div>
        <b>${sku.title}</b>
        <p>${sku.desc}</p>
      `

      // Полный поток покупки на любой кнопке: fake-door, вход, редирект кассы.
      const wireBuy = (btn: HTMLButtonElement): void => {
        btn.onclick = async () => {
          btn.disabled = true
          const result = await adapter.purchase(sku.id)
          if (result.status === 'unavailable') {
            // Честный ответ fake-door: намерение записано, денег не взяли.
            btn.textContent = 'Готовится — спасибо за интерес!'
            btn.classList.add('shop-noted')
          } else if (result.status === 'signin-required') {
            // Покупка живёт в аккаунте — иначе её не перенести на другое
            // устройство и не вернуть после чистки браузера. Кнопка сама
            // ведёт ко входу: «идите в меню» тестеры читали как тупик.
            btn.textContent = 'Войти и купить'
            btn.disabled = false
            btn.onclick = () => {
              close()
              hooks.onSignIn?.()
            }
          } else if (result.status === 'ok') {
            btn.textContent = 'В игре'
          } else {
            btn.disabled = false
          }
        }
      }

      // Применить — когда пак доступен сейчас. Купленный/бесплатный пак не «в
      // игре» сам по себе, его надо применить; смена сцены/колоды —
      // перезагрузка (§ PAID-PACKS): выгружать текстуры Pixi вживую не стоит.
      if (usable) {
        const apply = document.createElement('button')
        if (isApplied(sku.kind, sku.id)) {
          apply.textContent = 'Применено ✓'
          apply.disabled = true
        } else {
          apply.textContent = 'Применить'
          apply.onclick = () => {
            applyPack(sku.kind, sku.id)
            track('pack_apply', { sku: sku.id })
            location.reload()
          }
        }
        card.appendChild(apply)
      }

      // Купить — пока пак не принадлежит навсегда. На триале это тихая
      // вторичная «Оставить»: давить незачем, пак и так открыт сегодня, но
      // путь оставить его себе обязан быть виден именно в этот день.
      if (!owns && sku.price > 0) {
        const buy = document.createElement('button')
        if (onTrial) {
          buy.className = 'shop-keep-btn'
          buy.textContent = `Оставить · ${realPrice}`
        } else {
          buy.textContent = `Купить · ${realPrice}`
        }
        wireBuy(buy)
        card.appendChild(buy)
      }

      // «Посмотреть колоду» — витрина карт до покупки. Показываем только у
      // тех паков, у кого в каталоге есть картинка-превью.
      if (sku.preview) {
        const look = document.createElement('button')
        look.className = 'shop-preview-btn'
        look.textContent = 'Посмотреть колоду'
        look.onclick = () => openPreview(sku.preview!, sku.title)
        card.appendChild(look)
      }

      list.appendChild(card)
    }
  }

  // Лайтбокс поверх лавки: сама витрина одной картинкой. Живёт отдельным
  // оверлеем (z-index 50 в index.html), чтобы лечь над лавкой и титульником.
  function openPreview(src: string, title: string): void {
    track('deck_preview', { sku: title })
    const box = document.createElement('div')
    box.className = 'shop-lightbox'
    box.innerHTML = `
      <button class="shop-lightbox-close" aria-label="Закрыть">✕</button>
      <figure class="shop-lightbox-fig">
        <img src="${src}" alt="Колода «${title}» — примеры карт" />
        <figcaption>${title}</figcaption>
      </figure>
    `
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
      // Клик по фону или крестику закрывает; по самой картинке — нет.
      if (e.target === box || (e.target as HTMLElement).closest('.shop-lightbox-close')) shut()
    })
    window.addEventListener('keydown', onKey, true)
    root.appendChild(box)
    // Кадр на применение класса — плавное появление.
    requestAnimationFrame(() => box.classList.add('show'))
  }

  function close(): void {
    overlay.classList.remove('show')
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  ;(overlay.querySelector('[data-close]') as HTMLButtonElement).onclick = close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
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
