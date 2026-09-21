# Деплой и хозяйство сервера

Прод: **https://cozyspider.ru** (открывается без www, с www — редирект).
VPS RuVDS `root@195.43.142.151`, Ubuntu 24.04, 1 ГБ RAM. Доступ — по
SSH-ключу этой машины (`~/.ssh/id_ed25519`), пароль не нужен.

## Команды

```bash
npm run deploy       # фронт: build + заливка dist/ на сервер
npm run deploy:api   # бэкенд: server/*.mjs на сервер + npm install + рестарт
```

Оба скрипта в `tools/` (`deploy.mjs`, `deploy-api.mjs`) — Node, не bash:
npm на этой машине находит WSL-заглушку bash из System32, а PowerShell 5.1
портит бинарные пайпы. Node гоняет `tar → ssh` байт в байт.

## Карта сервера

| Что | Где |
|---|---|
| Статика фронта | `/var/www/cozy-spider` (прошлая сборка — рядом в `cozy-spider.old`) |
| Код API | `/opt/cozy-api` (index.mjs, smtp.mjs, package.json, node_modules) |
| База SQLite | `/var/lib/cozy-api/cozy.db` (WAL; **деплой её не трогает**) |
| Сервис | systemd `cozy-api`, слушает 127.0.0.1:8787, User=www-data |
| SMTP-конфиг | `/etc/systemd/system/cozy-api.service.d/smtp.conf` (см. ниже) |
| nginx | `/etc/nginx/sites-enabled/cozy-spider`: статика + `location /api/` → 8787 |
| TLS | certbot, обновляется сам |

Фронт-деплой атомарный: dist распаковывается в `cozy-spider.new`,
подменяется одним `mv`. Откат фронта:

```bash
ssh root@195.43.142.151 "rm -rf /var/www/cozy-spider && mv /var/www/cozy-spider.old /var/www/cozy-spider"
```

## Диагностика

```bash
ssh root@195.43.142.151 "systemctl status cozy-api; journalctl -u cozy-api -n 30 --no-pager"
```

```bash
curl -s https://cozyspider.ru/api/me
```

Смотреть базу (better-sqlite3 уже стоит в /opt/cozy-api, sqlite3-CLI нет):

```bash
ssh root@195.43.142.151 "node -e \"const D=require('/opt/cozy-api/node_modules/better-sqlite3');const db=new D('/var/lib/cozy-api/cozy.db');console.log(db.prepare('SELECT id,email,provider_id,display_name,email_verified FROM users').all())\""
```

## Дев-режим локально

```bash
$env:COZY_DB = "$env:TEMP\cozy-dev.db"; node server/index.mjs
```

Vite проксирует `/api` на 8787 сам (`vite.config.ts`). Без `COZY_DB` путь
серверный — локально переменная обязательна. Токены писем для теста
подкладываются в `email_tokens` прямо в SQLite (хранится sha256 от токена).

## SMTP (письма: сброс пароля, подтверждение почты)

**Ещё не настроен.** Код готов и деградирует честно: без SMTP регистрация
не требует подтверждения, «Забыли пароль?» отвечает «временно недоступно».

Включение: пароль приложения Яндекса (id.yandex.ru/security/app-passwords,
тип «Почта»), затем на сервере:

```bash
ssh root@195.43.142.151 "mkdir -p /etc/systemd/system/cozy-api.service.d && printf '[Service]\nEnvironment=COZY_SMTP_URL=smtps://ЛОГИН%%40yandex.ru:ПАРОЛЬ_ПРИЛОЖЕНИЯ@smtp.yandex.ru:465\n' > /etc/systemd/system/cozy-api.service.d/smtp.conf && systemctl daemon-reload && systemctl restart cozy-api"
```

Логин и пароль внутри URL кодируются как в URL (`@` в логине — `%40`;
в printf процент удваивается). Отправитель по умолчанию — логин, можно
переопределить второй строкой `Environment=COZY_MAIL_FROM=...`.

## ЮKassa (оплата паков)

Ключи — те же systemd drop-in, что и SMTP. Без них `POST /api/purchase`
отвечает 503, лавка деградирует в fake-door — код деплоится до онбординга.

```bash
ssh root@195.43.142.151 "mkdir -p /etc/systemd/system/cozy-api.service.d && printf '[Service]\nEnvironment=COZY_YK_SHOP_ID=МАГАЗИН\nEnvironment=COZY_YK_SECRET=СЕКРЕТНЫЙ_КЛЮЧ\n' > /etc/systemd/system/cozy-api.service.d/yookassa.conf && chmod 600 /etc/systemd/system/cozy-api.service.d/yookassa.conf && systemctl daemon-reload && systemctl restart cozy-api"
```

- Тестовый магазин и боевой различаются только парой ключей (`test_*` /
  `live_*`); переключение — правка drop-in + рестарт.
- В кабинете ЮKassa: «Интеграция → HTTP-уведомления», URL
  `https://cozyspider.ru/api/yookassa/webhook`, события `payment.succeeded`
  и `payment.canceled`. Вебхук перепроверяет платёж GET-ом у ЮKassa, телу
  уведомления сервер не верит — подделка бесполезна.
- Возврат игрока (`/?purchase=1`) дёргает `POST /api/purchase/sync` — он
  доводит покупку и без вебхука, вебхук страхует брошенные вкладки.
- Цены сервер читает из `/var/www/cozy-spider/assets/shop.json`
  (переопределяется `COZY_CATALOG`) — суммам от клиента не верит.
- **Чеки:** автоотправки в «Мой налог» у ЮKassa больше нет (закрыта
  29.12.2025) — после каждой продажи чек пробивается вручную в приложении.
  Включить в кабинете почтовые уведомления о платежах, чтобы не пропускать.

Посмотреть платежи:

```bash
ssh root@195.43.142.151 "node -e \"const D=require('/opt/cozy-api/node_modules/better-sqlite3');const db=new D('/var/lib/cozy-api/cozy.db');console.log(db.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 20').all())\""
```

Дев: тестовые ключи в переменные окружения + каталог из репозитория:

```powershell
$env:COZY_DB = "$env:TEMP\cozy-dev.db"; $env:COZY_CATALOG = "public/assets/shop.json"; $env:COZY_YK_SHOP_ID = "..."; $env:COZY_YK_SECRET = "..."; node server/index.mjs
```

Тестовая карта: `5555 5555 5555 4444`, любые CVC и будущая дата.

## Кэш ассетов (nginx)

В `/etc/nginx/sites-available/cozy-spider` две политики для `/assets/`:

- `*.webp/*.png/*.json` — `Cache-Control: no-cache`: браузер кеширует,
  но каждый раз сверяет ETag (обычно мгновенный 304). Игровые ассеты
  живут под постоянными именами, им нельзя immutable — обновление
  сцены месяц не доезжало бы до игроков.
- всё остальное в `/assets/` (JS/CSS Vite c хешем в имени) —
  `public, immutable, 30d`.

Ловушка: у тех, кто заходил ДО этого разделения, старые ассеты лежат
с immutable до жёсткой перезагрузки (Ctrl+F5) — один раз, дальше
no-cache сам себя обслуживает.

## Ловушки

- **Redirect URI OAuth сравниваются побайтово.** Игра шлёт
  `origin + pathname` — со слэшем на конце (`https://cozyspider.ru/`).
  В кабинетах провайдеров должны быть варианты и с www, и без.
- **VK**: доверенные redirect URL в кабинете id.vk.ru **добавлены**
  (Приложение → «Подключение авторизации»). Базовые домены — `cozyspider.ru`
  и `www.cozyspider.ru`; redirect — `https://cozyspider.ru/`,
  `https://cozyspider.ru`, `https://www.cozyspider.ru/`,
  `https://www.cozyspider.ru`. Ключевой — `https://cozyspider.ru/`: игра
  открывается без www и шлёт `origin + pathname` со слэшем. Пока стояли
  только www-варианты, VK ID падал «Ошибкой загрузки» (в консоли
  `redirect_uri is missing or invalid`). Локальные `http://localhost:*` в
  кабинет не заведены — VK-вход в деве не поднимется, пока не добавить туда
  актуальный дев-порт (сейчас `5273`, см. `.claude/launch.json`). Яндекс
  работал и без этих правок.
- **База — не в деплое.** `deploy:api` не трогает `/var/lib/cozy-api`;
  миграции схемы делаются в `index.mjs` на старте (`CREATE TABLE IF NOT
  EXISTS` + try/catch `ALTER TABLE`).
- Клиентские ID OAuth — константы в `src/app/platform/oauth.ts`
  (VK 54746677, Яндекс 05f467cebe9b43fdaf5e169b0599c404); тот же VK App ID
  продублирован в `server/index.mjs` для проверки токенов.
