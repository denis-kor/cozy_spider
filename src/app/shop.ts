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

    list.innerHTML = ''
    for (const sku of catalog.skus) {
      const card = document.createElement('div')
      card.className = 'shop-card'

      const price = sku.price === 0 ? 'бесплатно' : `${sku.price} ${catalog.currency}`
      const has = owned.has(sku.id) || sku.price === 0

      card.innerHTML = `
        <div class="shop-card-top">
          <span class="shop-kind">${KIND_LABEL[sku.kind]}</span>
          <span class="shop-price">${price}</span>
        </div>
        <b>${sku.title}</b>
        <p>${sku.desc}</p>
      `

      const action = document.createElement('button')
      if (has) {
        // Купленный (или бесплатный) пак не «в игре» сам по себе — его
        // ещё надо применить. Смена сцены/колоды — перезагрузка (§ PAID-PACKS):
        // выгружать и грузить все текстуры Pixi вживую не стоит того.
        if (isApplied(sku.kind, sku.id)) {
          action.textContent = 'Применено ✓'
          action.disabled = true
        } else {
          action.textContent = 'Применить'
          action.onclick = () => {
            applyPack(sku.kind, sku.id)
            track('pack_apply', { sku: sku.id })
            location.reload()
          }
        }
      } else {
        action.textContent = `Купить · ${price}`
        action.onclick = async () => {
          action.disabled = true
          const result = await adapter.purchase(sku.id)
          if (result.status === 'unavailable') {
            // Честный ответ fake-door: намерение записано, денег не взяли.
            action.textContent = 'Готовится — спасибо за интерес!'
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
      }
      card.appendChild(action)
      list.appendChild(card)
    }
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
