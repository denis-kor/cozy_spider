/**
 * Плашка после победы: «Играть дальше» и «Меню».
 *
 * Появляется поверх финального эффекта. Обязательна по делу, а не для
 * красоты: к этому моменту карты со стола уже разлетелись, и без неё
 * игрок остался бы наедине с пустой сценой.
 */

export interface WinPlaqueActions {
  onPlayAgain: () => void
  onMenu: () => void
}

let current: HTMLElement | null = null

export function showWinPlaque(actions: WinPlaqueActions): void {
  if (current) return

  const el = document.createElement('div')
  el.className = 'win-plaque'
  el.innerHTML = `
    <div class="win-plaque-title">Собрано!</div>
    <div class="win-plaque-sub">пасьянс сошёлся</div>
    <div class="win-plaque-row">
      <button data-again>Играть дальше</button>
      <button data-menu>Меню</button>
    </div>
  `
  document.body.appendChild(el)
  current = el

  const close = (): void => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 400)
    current = null
  }

  el.querySelector<HTMLButtonElement>('[data-again]')!.onclick = () => {
    close()
    actions.onPlayAgain()
  }
  el.querySelector<HTMLButtonElement>('[data-menu]')!.onclick = () => {
    close()
    actions.onMenu()
  }

  requestAnimationFrame(() => el.classList.add('show'))
}
