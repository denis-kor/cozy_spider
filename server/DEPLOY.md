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

## Безопасность (nginx)

**Реальный IP для лимитера.** `server/index.mjs` берёт клиентский адрес из
заголовка `X-Real-IP` — сокет за прокси всегда `127.0.0.1`, и без этого
лимитер на авторизационных ручках вырождается в один общий счётчик на всех
(31 запрос — и вход/регистрация/сброс отвечают 429 всем сразу). В блоке
`location /api/` обязателен:

```nginx
location /api/ {
    proxy_set_header X-Real-IP $remote_addr;   # НЕ $proxy_add_x_forwarded_for:
                                               # тот склеивает XFF от клиента и подделывается
    proxy_pass http://127.0.0.1:8787;
}
```

Наружу торчит только nginx (Node слушает `127.0.0.1`), поэтому `X-Real-IP`,
проставленный здесь, клиенту не подделать.

**Заголовки безопасности.** В 443-блок стоит добавить (закрывают
кликджекинг формы входа, sniffing и остаточный риск XSS):

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000" always;
# CSP: разрешаем свой origin + Яндекс.Метрику; при желании ужать до nonce.
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://avatars.yandex.net https://mc.yandex.ru; script-src 'self' 'unsafe-inline' https://mc.yandex.ru; connect-src 'self' https://mc.yandex.ru https://id.vk.com https://login.yandex.ru; frame-src https://mc.yandex.ru; style-src 'self' 'unsafe-inline'" always;
```

CSP выше — рабочий минимум под текущий фронт (инлайн-стили в `index.html`,
сниппет Метрики, аватары Яндекса как `https`/`data:`). После перевода
Метрики на строгий режим `'unsafe-inline'` в `script-src` можно убрать.

**Webvisor на форме входа.** Метрика поднята с `webvisor:true` — запись
сессии работает и на плашке почта+пароль. Поле пароля Метрика маскирует, но
для формы входа запись лучше выключать (в интерфейсе Метрики — не писать
формы, либо `data-*`-разметка полей).

## OAuth Яндекса: известное ограничение (audience токена)

**Статус: не закрыто, принято осознанно.** Вход Яндекса идёт implicit-flow
(`response_type=token`, `oauth.ts`), а сервер проверяет токен через
`login.yandex.ru/info`. Проблема: этот эндпоинт отдаёт пользователя по
**любому валидному яндекс-токену**, не сверяя, какому приложению он выдан.
То есть проверка отсекает выдуманный токен, но НЕ токен жертвы, выданный
другому яндекс-приложению: добыв такой токен (свой OAuth-апп, утечка
implicit-редиректа и т.п.), его можно переиграть на `POST /api/oauth` и
войти в чужой аккаунт cozyspider. Барьер — нужен чужой валидный токен,
поэтому это средняя, а не критичная дыра.

VK этим не страдает: там PKCE + authorization code, а `user_info` вызывается
с `client_id` — токен привязан к нашему приложению.

**План закрытия (перевод Яндекса на code-flow, как у VK):**

1. В кабинете `oauth.yandex.ru` у приложения включить и скопировать
   **секрет** (client secret).
2. Положить его в тот же systemd drop-in, что SMTP/ЮKassa:
   `Environment=COZY_YANDEX_SECRET=...`, `chmod 600`, `daemon-reload`,
   `restart`.
3. Клиент (`oauth.ts`): для Яндекса запрашивать `response_type=code` вместо
   `token`; `code` уезжает на сервер.
4. Сервер (`/api/oauth`): для Яндекса менять `code` на токен запросом к
   `https://oauth.yandex.ru/token` с `client_id`+`client_secret` — токен,
   полученный по нашему секрету, гарантированно выдан нашему приложению
   (audience привязан), дальше как сейчас `login.yandex.ru/info`.

Деплой фронта и API — синхронно: без секрета на сервере вход Яндекса
перестанет проходить, поэтому шаги 1–2 до выкладки 3–4.

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

## Короткие ссылки соцсетей (redirects)

Для рекламных роликов используются короткие брендовые ссылки, которые
редиректят на полный URL с UTM-меткой (Янд.Метрика читает источник):

| Ссылка | Куда ведёт |
|---|---|
| `cozyspider.ru/vk/<ролик>` | `/?utm_source=vk&…&utm_content=<ролик>` |
| `cozyspider.ru/yt/<ролик>` | `/?utm_source=youtube&…&utm_content=<ролик>` |
| `cozyspider.ru/tt` | `/?utm_source=tiktok&…&utm_content=bio` |
| `cozyspider.ru/ig` | `/?utm_source=instagram&…&utm_content=bio` |

Правила лежат отдельным сниппетом `/etc/nginx/snippets/cozy-shortlinks.conf`
и подключаются `include` в 443-блоке перед `location /`. Кампания зашита в
сниппете (`utm_campaign=spider_launch`) — для новой волны роликов правь её там.

Включение (идемпотентно; оригинал конфига бэкапится в `/root/cozy-spider.nginx.orig`):

```bash
ssh root@195.43.142.151 'bash -s' <<'REMOTE'
set -e
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/cozy-shortlinks.conf <<'CONF'
location ~ ^/vk/([A-Za-z0-9_]+)/?$ { return 302 https://cozyspider.ru/?utm_source=vk&utm_medium=social&utm_campaign=spider_launch&utm_content=$1; }
location ~ ^/yt/([A-Za-z0-9_]+)/?$ { return 302 https://cozyspider.ru/?utm_source=youtube&utm_medium=social&utm_campaign=spider_launch&utm_content=$1; }
location = /tt { return 302 https://cozyspider.ru/?utm_source=tiktok&utm_medium=social&utm_campaign=spider_launch&utm_content=bio; }
location = /ig { return 302 https://cozyspider.ru/?utm_source=instagram&utm_medium=social&utm_campaign=spider_launch&utm_content=bio; }
CONF
test -f /root/cozy-spider.nginx.orig || cp /etc/nginx/sites-available/cozy-spider /root/cozy-spider.nginx.orig
grep -q 'cozy-shortlinks.conf' /etc/nginx/sites-available/cozy-spider || \
  sed -i 's|    location / {|    include snippets/cozy-shortlinks.conf;\n\n    location / {|' /etc/nginx/sites-available/cozy-spider
nginx -t && systemctl reload nginx && echo OK-SHORTLINKS-ON
REMOTE
```

Проверка: `curl -sI https://cozyspider.ru/vk/spider_bit` — в ответе `location:`
с `utm_source=vk`. Откат: удалить `include`-строку из конфига (или вернуть
`/root/cozy-spider.nginx.orig`) и `systemctl reload nginx`.

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
