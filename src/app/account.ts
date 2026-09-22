import type { PlatformAdapter, Sku, User } from './platform/types'
import { track } from './track'

/**
 * Плашка профиля: кто ты, какой у тебя аватар и что из лавки уже в игре.
 *
 * Аватар приходит от провайдера при входе, но его можно заменить своей
 * картинкой — она ужимается до 96×96 и живёт в localStorage вместе с
 * профилем. Покупки — тот же каталог, что в лавке (`shop.json`), плюс
 * энтайтлменты адаптера: у витрины и профиля не может быть двух мнений
 * о том, что куплено.
 */

interface CatalogSku {
  id: Sku
  kind: 'scene' | 'deck'
  title: string
  price: number
}

interface Catalog {
  currency: string
  skus: CatalogSku[]
}

const AVATAR_SIZE = 96

export interface AccountPanel {
  open(): void
}

export function mountAccount(
  root: HTMLElement,
  adapter: PlatformAdapter,
  opts: { onShop(): void; onSignedOut(): void },
): AccountPanel {
  const overlay = document.createElement('div')
  overlay.className = 'shop-overlay over-start'
  overlay.innerHTML = `
    <div class="shop-panel acct-panel" role="dialog" aria-label="Профиль">
      <div class="shop-head">
        <span class="shop-title">Профиль</span>
        <button class="shop-close" data-close aria-label="Закрыть">✕</button>
      </div>
      <div class="acct-id">
        <div class="acct-avatar" data-avatar></div>
        <div class="acct-who">
          <div class="acct-name" data-name></div>
          <label class="acct-avatar-btn">Сменить аватар<input type="file" accept="image/*" data-file hidden></label>
        </div>
      </div>
      <div class="acct-sub">покупки</div>
      <div class="acct-owned" data-owned>Загрузка…</div>
      <div class="acct-actions">
        <button data-shop>Открыть лавку</button>
        <button class="acct-signout" data-signout>Выйти из аккаунта</button>
      </div>
    </div>
  `
  root.appendChild(overlay)

  const avatarEl = overlay.querySelector('[data-avatar]') as HTMLElement
  const nameEl = overlay.querySelector('[data-name]') as HTMLElement
  const ownedEl = overlay.querySelector('[data-owned]') as HTMLElement
  const fileEl = overlay.querySelector('[data-file]') as HTMLInputElement

  function renderIdentity(user: User): void {
    nameEl.textContent = user.displayName ?? 'Без имени'
    if (user.avatarUrl) {
      avatarEl.innerHTML = ''
      const img = document.createElement('img')
      img.src = user.avatarUrl
      img.alt = ''
      avatarEl.appendChild(img)
    } else {
      // Заглушка — первая буква имени, в духе «игра работает без картинок».
      avatarEl.textContent = (user.displayName ?? '?').slice(0, 1).toUpperCase()
    }
  }

  async function renderPurchases(): Promise<void> {
    try {
      const [catalog, owned] = await Promise.all([
        fetch('/assets/shop.json', { cache: 'no-cache' }).then((r) => r.json() as Promise<Catalog>),
        adapter.getEntitlements(),
      ])
      // Триал кешируется в getEntitlements — читаем после него.
      const trialSkus = new Set(adapter.getTrial?.()?.skus ?? [])
      ownedEl.innerHTML = ''
      for (const sku of catalog.skus) {
        const has = owned.has(sku.id) || sku.price === 0
        const onTrial = trialSkus.has(sku.id)
        const rightText = onTrial ? 'первый день' : has ? '✓ в игре' : `${sku.price} ${catalog.currency}`
        const row = document.createElement('div')
        row.className = 'acct-sku' + (has ? ' acct-sku-owned' : '')
        row.innerHTML = `<span>${sku.title}</span><span>${rightText}</span>`
        ownedEl.appendChild(row)
      }
    } catch {
      ownedEl.textContent = 'Список покупок не загрузился'
    }
  }

  fileEl.onchange = () => {
    const file = fileEl.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = async () => {
      URL.revokeObjectURL(url)
      // Квадрат по центру, ужатый до AVATAR_SIZE: в localStorage должен
      // лезть любой снимок с телефона.
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = AVATAR_SIZE
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        AVATAR_SIZE,
        AVATAR_SIZE,
      )
      const updated = await adapter.setAvatar?.(canvas.toDataURL('image/jpeg', 0.85))
      if (updated) renderIdentity(updated)
      track('avatar_set')
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  ;(overlay.querySelector('[data-shop]') as HTMLButtonElement).onclick = () => {
    overlay.classList.remove('show')
    opts.onShop()
  }
  ;(overlay.querySelector('[data-signout]') as HTMLButtonElement).onclick = async () => {
    track('signout_click')
    await adapter.signOut()
    overlay.classList.remove('show')
    opts.onSignedOut()
  }

  const close = (): void => overlay.classList.remove('show')
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  ;(overlay.querySelector('[data-close]') as HTMLButtonElement).onclick = close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })

  return {
    open() {
      void adapter.getUser().then((user) => {
        if (!user) return // профиль без входа не открывается
        renderIdentity(user)
        void renderPurchases()
        overlay.classList.add('show')
        track('account_open')
      })
    },
  }
}
