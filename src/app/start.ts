import type { PlatformAdapter, User } from './platform/types'
import { track } from './track'

/**
 * Титульный экран.
 *
 * Игра загружается и живёт позади него: сцена с дождём и лампой — лучшая
 * заставка, которую можно придумать, глупо прятать её за картинкой.
 *
 * Вход — через VK ID и Яндекс, редиректом (`WebAdapter`). Регистрация по
 * почте — отдельная плашка-fake-door: настоящая почтовая учётка требует
 * бэкенда (пароли, письма подтверждения), поэтому пока считаем интерес,
 * а сам адрес никуда не отправляем и не сохраняем.
 */

export interface StartScreen {
  open(): void
}

const PROVIDERS: { id: 'vk' | 'yandex'; label: string }[] = [
  { id: 'vk', label: 'VK ID' },
  { id: 'yandex', label: 'Яндекс' },
]

const GUEST_NOTE = 'Аккаунт сохранит прогресс и покупки на всех устройствах'
const SIGNED_NOTE = 'Прогресс пока хранится на этом устройстве; облачные сохранения готовятся'
const MAIL_NOTE = 'Аккаунт восстановит прогресс и покупки на новом устройстве'

export function mountStart(
  root: HTMLElement,
  adapter: PlatformAdapter,
  opts: { onAccount(): void; onShop(): void },
): StartScreen {
  const overlay = document.createElement('div')
  overlay.className = 'start-overlay'
  overlay.innerHTML = `
    <div class="start-panel">
      <div class="start-title">Паук</div>
      <div class="start-sub">уютный пасьянс у пруда</div>
      <button class="start-play" data-play>Играть</button>
      <button class="start-shop" data-shop>Лавка · паки оформления</button>
      <div class="start-account">
        <div class="start-account-head">аккаунт</div>
        <button class="start-me" data-me hidden>
          <span class="start-me-avatar" data-me-avatar></span>
          <span data-me-name></span>
        </button>
        <div class="start-user" data-user></div>
        <div class="start-providers" data-providers></div>
        <div class="start-note" data-note></div>
        <button class="start-resend" data-resend hidden>отправить письмо ещё раз</button>
        <div class="start-legal">
          <a href="/privacy.html" target="_blank">политика конфиденциальности</a>
          · <a href="/oferta.html" target="_blank">оферта</a>
        </div>
      </div>
    </div>
  `
  root.appendChild(overlay)

  // Отдельная плашка регистрации по почте.
  const mail = document.createElement('div')
  mail.className = 'shop-overlay over-start'
  mail.innerHTML = `
    <div class="shop-panel mail-panel" role="dialog" aria-label="Вход по почте">
      <div class="shop-head">
        <span class="shop-title" data-mail-title>Вход по почте</span>
        <button class="shop-close" data-close aria-label="Закрыть">✕</button>
      </div>
      <form class="mail-form" data-form>
        <input type="email" required placeholder="you@example.ru" autocomplete="username" data-email>
        <input type="password" required placeholder="пароль" minlength="6" autocomplete="current-password" data-password>
        <div class="mail-actions">
          <button type="submit" data-mode="signin">Войти</button>
          <button type="submit" data-mode="signup">Зарегистрироваться</button>
        </div>
        <button type="button" class="mail-forgot" data-forgot>Забыли пароль?</button>
      </form>
      <div class="shop-note" data-mail-note>${MAIL_NOTE}</div>
      <div class="shop-note start-legal">Регистрируясь или входя, вы соглашаетесь с
        <a href="/privacy.html" target="_blank">политикой конфиденциальности</a></div>
    </div>
  `
  root.appendChild(mail)

  const userEl = overlay.querySelector('[data-user]') as HTMLElement
  const note = overlay.querySelector('[data-note]') as HTMLElement
  const providers = overlay.querySelector('[data-providers]') as HTMLElement
  const me = overlay.querySelector('[data-me]') as HTMLButtonElement
  const meAvatar = overlay.querySelector('[data-me-avatar]') as HTMLElement
  const meName = overlay.querySelector('[data-me-name]') as HTMLElement

  const resend = overlay.querySelector('[data-resend]') as HTMLButtonElement

  function render(user: User | null): void {
    if (user) {
      me.hidden = false
      meName.textContent = user.displayName ?? 'Вы вошли'
      if (user.avatarUrl) {
        meAvatar.innerHTML = `<img src="${user.avatarUrl}" alt="">`
      } else {
        meAvatar.textContent = (user.displayName ?? '?').slice(0, 1).toUpperCase()
      }
      userEl.hidden = true
      note.textContent =
        user.emailVerified === false ? 'Подтвердите почту — мы отправили вам письмо со ссылкой' : SIGNED_NOTE
    } else {
      me.hidden = true
      userEl.hidden = false
      userEl.textContent = 'Вы играете как гость'
      note.textContent = GUEST_NOTE
    }
    note.classList.remove('start-note-active')
    resend.hidden = !(user && user.emailVerified === false && adapter.resendConfirmEmail)
    providers.style.display = user ? 'none' : ''
  }

  resend.onclick = async () => {
    try {
      await adapter.resendConfirmEmail?.()
      note.textContent = 'Отправили ещё раз — проверьте почту (и папку «Спам»)'
    } catch (err) {
      note.textContent = err instanceof Error ? err.message : 'Не получилось отправить'
    }
    note.classList.add('start-note-active')
  }

  for (const p of PROVIDERS) {
    const b = document.createElement('button')
    b.textContent = p.label
    b.onclick = async () => {
      track('signin_click', { provider: p.id })
      try {
        // При настроенном OAuth страница уходит на провайдера и промис не
        // вернётся; продолжение — в WebAdapter.init() после редиректа.
        render(await adapter.signIn(p.id))
      } catch {
        // Провайдер не подключён — говорим как есть.
        note.textContent = 'Вход появится совсем скоро. Ваш интерес записан — спасибо!'
        note.classList.add('start-note-active')
      }
    }
    providers.appendChild(b)
  }

  const mailTitle = mail.querySelector('[data-mail-title]') as HTMLElement
  const mailNote = mail.querySelector('[data-mail-note]') as HTMLElement
  const mailForm = mail.querySelector('[data-form]') as HTMLFormElement
  const emailInput = mailForm.querySelector('[data-email]') as HTMLInputElement
  const passwordInput = mailForm.querySelector('[data-password]') as HTMLInputElement
  const signupBtn = mailForm.querySelector('[data-mode="signup"]') as HTMLButtonElement
  const signinBtn = mailForm.querySelector('[data-mode="signin"]') as HTMLButtonElement
  const forgotBtn = mailForm.querySelector('[data-forgot]') as HTMLButtonElement

  /** Токен из письма о смене пароля: пока он есть, плашка в режиме «новый пароль». */
  let resetToken: string | null = null

  function resetMailUi(): void {
    resetToken = null
    mailTitle.textContent = 'Вход по почте'
    emailInput.hidden = false
    emailInput.required = true
    passwordInput.placeholder = 'пароль'
    passwordInput.autocomplete = 'current-password'
    signinBtn.textContent = 'Войти'
    signupBtn.hidden = false
    forgotBtn.hidden = adapter.requestPasswordReset === undefined
    mailForm.hidden = false
    mailNote.textContent = MAIL_NOTE
    mailNote.classList.remove('start-note-active')
  }

  const mailBtn = document.createElement('button')
  mailBtn.textContent = 'Почта'
  mailBtn.onclick = () => {
    track('signin_click', { provider: 'email' })
    // Свежая плашка при каждом открытии: форма на месте, заметка исходная.
    resetMailUi()
    mail.classList.add('show')
  }
  providers.appendChild(mailBtn)

  // Какой из двух submit-кнопок нажали — узнаём до события формы.
  let mailMode: 'signin' | 'signup' = 'signin'
  for (const b of mailForm.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    b.addEventListener('click', () => (mailMode = b.dataset.mode as typeof mailMode))
  }

  forgotBtn.onclick = async () => {
    if (!emailInput.reportValidity()) return
    track('reset_request')
    try {
      await adapter.requestPasswordReset?.(emailInput.value)
      mailNote.textContent =
        'Если такая почта зарегистрирована — письмо уже едет. Ссылка в нём действует час'
    } catch (err) {
      mailNote.textContent = err instanceof Error ? err.message : 'Не получилось — попробуйте позже'
    }
    mailNote.classList.add('start-note-active')
  }

  mailForm.onsubmit = async (e) => {
    e.preventDefault()

    if (resetToken) {
      if (!adapter.confirmPasswordReset) return
      try {
        const user = await adapter.confirmPasswordReset(resetToken, passwordInput.value)
        mail.classList.remove('show')
        render(user)
      } catch (err) {
        mailNote.textContent = err instanceof Error ? err.message : 'Не получилось — попробуйте ещё раз'
        mailNote.classList.add('start-note-active')
      }
      return
    }

    track(mailMode === 'signup' ? 'signup_email_submit' : 'signin_email_submit')

    const doAuth = mailMode === 'signup' ? adapter.emailRegister : adapter.emailLogin
    if (!doAuth) {
      // Адаптер без почтовых учёток — остаёмся fake-door: ничего не уходит.
      mailForm.hidden = true
      mailNote.textContent =
        (mailMode === 'signup' ? 'Регистрация' : 'Вход') +
        ' по почте появится вместе с облачными сохранениями. ' +
        'Почту и пароль мы никуда не отправляли — а интерес записали, спасибо!'
      mailNote.classList.add('start-note-active')
      return
    }

    try {
      const user = await doAuth.call(adapter, emailInput.value, passwordInput.value)
      mail.classList.remove('show')
      render(user)
    } catch (err) {
      // Сервер отвечает по-русски: «почта занята», «неверный пароль»…
      mailNote.textContent = err instanceof Error ? err.message : 'Не получилось — попробуйте ещё раз'
      mailNote.classList.add('start-note-active')
    }
  }
  const closeMail = (): void => mail.classList.remove('show')
  mail.addEventListener('click', (e) => {
    if (e.target === mail) closeMail()
  })
  ;(mail.querySelector('[data-close]') as HTMLButtonElement).onclick = closeMail

  me.onclick = () => opts.onAccount()

  ;(overlay.querySelector('[data-play]') as HTMLButtonElement).onclick = () => {
    track('start_play')
    overlay.classList.remove('show')
  }

  // Лавка доступна с порога: гость (и модерация кассы) видит товары и
  // цены, не начиная партию. Открывается поверх титульника (`over-start`).
  ;(overlay.querySelector('[data-shop]') as HTMLButtonElement).onclick = () => opts.onShop()

  render(null)
  // Адаптер мог восстановить сессию или довести вход после редиректа.
  void adapter.getUser().then(render)

  // Ссылки из писем: ?confirm= подтверждает почту, ?reset= открывает
  // плашку нового пароля. ?purchase= — возврат со страницы оплаты ЮKassa.
  // Параметры вычищаем из адресной строки сразу.
  const params = new URLSearchParams(location.search)
  const confirmToken = params.get('confirm')
  const passResetToken = params.get('reset')
  const fromPayment = params.has('purchase')
  if (confirmToken || passResetToken || fromPayment) history.replaceState(null, '', location.pathname)

  if (fromPayment && adapter.syncPurchases) {
    void adapter
      .syncPurchases()
      .then(({ granted, pending }) => {
        for (const sku of granted) track('purchase_done', { sku })
        note.textContent = granted.length
          ? 'Покупка получена — спасибо! Пак ждёт в лавке, кнопка «Применить».'
          : pending
            ? 'Оплата ещё обрабатывается — пак появится в лавке через минуту-другую.'
            : 'Оплата не прошла — деньги не списаны.'
        note.classList.add('start-note-active')
      })
      .catch(() => {
        // Сеть моргнула на возврате: не страшно, вебхук доведёт покупку,
        // а лавка перечитывает права при каждом открытии.
      })
  }

  if (confirmToken && adapter.confirmEmail) {
    void adapter
      .confirmEmail(confirmToken)
      .then(async () => {
        render(await adapter.getUser())
        note.textContent = 'Почта подтверждена — спасибо!'
        note.classList.add('start-note-active')
      })
      .catch((err: unknown) => {
        note.textContent = err instanceof Error ? err.message : 'Ссылка не сработала'
        note.classList.add('start-note-active')
      })
  }

  if (passResetToken && adapter.confirmPasswordReset) {
    resetMailUi()
    resetToken = passResetToken
    mailTitle.textContent = 'Новый пароль'
    emailInput.hidden = true
    emailInput.required = false
    passwordInput.placeholder = 'новый пароль'
    passwordInput.autocomplete = 'new-password'
    signinBtn.textContent = 'Сохранить пароль'
    signupBtn.hidden = true
    forgotBtn.hidden = true
    mail.classList.add('show')
  }

  return {
    open() {
      // Профиль могли изменить (аватар, выход) — перечитываем.
      void adapter.getUser().then(render)
      overlay.classList.add('show')
    },
  }
}
