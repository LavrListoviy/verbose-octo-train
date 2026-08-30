# Telegram-бот регистрации пользователей

Минимальный Telegram-бот на TypeScript для создания аккаунтов пользователей. Состояние незавершённой регистрации хранится в PostgreSQL, поэтому перезапуск приложения не сбрасывает анкету.

## Что реализовано

- пошаговая регистрация через `/start`;
- обязательные отображаемое имя и дата рождения;
- запрет регистрации для пользователей младше 16 лет;
- необязательные аватар, раздел «о себе», город и страна;
- загрузка отдельного аватара или использование аватара Telegram как запасного варианта;
- таблицы ролей, разрешений и их связей с пользователями;
- идемпотентный сид ролей, разрешений и главного администратора;
- автоматический запуск миграций и сида перед ботом в Docker Compose;
- аудит входящих Telegram updates и изменений регистрации с полными снимками и diff;
- структурированные application logs и автоматическое удаление аудита старше трёх лет;
- тесты на Jest и готовый workflow GitHub Actions.

Управление личным кабинетом, ролями и правами пока не подключено к интерфейсу бота. Структура БД для этого уже заложена.

## Требования

- Docker Engine с Compose plugin;
- на Windows — WSL2 с дистрибутивом `Ubuntu-24.04` и Docker Engine внутри него;
- токен бота от [@BotFather](https://t.me/BotFather);
- Telegram ID главного администратора.

## Переменные окружения

Создайте `.env` на основе `.env.example`. Сам `.env` игнорируется Git и не должен попадать в репозиторий.

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `BOT_TOKEN` | да | Секретный токен Telegram-бота |
| `DATABASE_URL` | да | Строка подключения приложения к PostgreSQL |
| `POSTGRES_DB` | да | Имя базы данных для контейнера PostgreSQL |
| `POSTGRES_USER` | да | Пользователь PostgreSQL |
| `POSTGRES_PASSWORD` | да | Пароль PostgreSQL |
| `ADMIN_TELEGRAM_ID` | да | Числовой Telegram ID главного администратора |
| `AUDIT_RETENTION_YEARS` | нет | Срок хранения аудита в календарных годах, минимум `3`, по умолчанию `3` |
| `LOG_LEVEL` | нет | Уровень application logs: `trace`, `debug`, `info`, `warn`, `error` или `fatal` |
| `LOG_PRETTY` | нет | `true` для читаемого локального вывода, `false` для JSON в Docker и production |

Для Docker Compose хостом в `DATABASE_URL` должен быть сервис `db`, например:

```env
BOT_TOKEN=1234567890:real_bot_token
DATABASE_URL=postgres://bot:strong_password@db:5432/bot
POSTGRES_DB=bot
POSTGRES_USER=bot
POSTGRES_PASSWORD=strong_password
ADMIN_TELEGRAM_ID=123456789
AUDIT_RETENTION_YEARS=3
LOG_LEVEL=info
LOG_PRETTY=false
```

## Запуск в Docker

```powershell
Copy-Item .env.example .env
# Заполните .env реальными значениями
wsl --distribution Ubuntu-24.04 --user root --cd /mnt/c/path/to/project -- docker compose up --build
```

Вместо `/mnt/c/path/to/project` укажите WSL-путь к каталогу проекта. Например, Windows-путь `C:\Projects\bot` соответствует `/mnt/c/Projects/bot`. На Linux достаточно обычной команды `docker compose up --build` из корня проекта.

Контейнер `bot` после готовности PostgreSQL последовательно выполняет миграции, сид и запускает long polling. Повторный запуск безопасен: миграции и сид идемпотентны.

Главный администратор создаётся в статусе `pending` и сразу получает роль `super_admin`. После обычной регистрации через `/start` запись активируется, а административная роль сохраняется.

Остановить окружение:

```powershell
wsl --distribution Ubuntu-24.04 --user root --cd /mnt/c/path/to/project -- docker compose down
```

Удалить также локальные данные PostgreSQL:

```powershell
wsl --distribution Ubuntu-24.04 --user root --cd /mnt/c/path/to/project -- docker compose down --volumes
```

Последняя команда безвозвратно удаляет локальную базу. Не надо запускать её машинально — Docker послушно снесёт данные и даже не покраснеет.

## Локальная разработка без контейнера приложения

Поднимите PostgreSQL, установите зависимости и задайте `DATABASE_URL` с доступным хостом, обычно `localhost`:

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Для локальной отладки можно задать `LOG_PRETTY=true` и `LOG_LEVEL=debug`. В Docker рекомендуется оставлять `LOG_PRETTY=false`, чтобы каждая запись была отдельным JSON-объектом и нормально обрабатывалась системами сбора логов.

## Аудит и хранение данных

Таблица `audit_logs` является журналом прикладных событий. Для каждой записи сохраняются:

- время события и correlation ID;
- Telegram update ID и Telegram ID инициатора;
- код действия, тип и идентификатор сущности;
- снимки `before` и `after`, вычисленный `diff` и технические метаданные.

Каждый полученный Telegram update сохраняется в PostgreSQL целиком в `metadata`, включая текст сообщений и остальные данные Telegram. Успешные изменения регистрации дополнительно записываются в той же транзакции, что и изменяемые данные. Поэтому изменение не может сохраниться без соответствующей записи аудита.

Очистка запускается при старте приложения и затем каждые 24 часа. Она пакетами удаляет только записи, которые старше `AUDIT_RETENTION_YEARS` полных календарных лет. Значение меньше трёх приложение не примет. Ручной запуск той же процедуры:

```powershell
npm run db:audit:cleanup
```

Аудит содержит персональные данные. Доступ к PostgreSQL, резервным копиям и дампам должен быть ограничен; `POSTGRES_PASSWORD` и `DATABASE_URL` нельзя писать в репозиторий или application logs. Сам по себе retention не заменяет требования к шифрованию, контролю доступа и резервному копированию — было бы слишком удобно.

## Логи приложения

Pino пишет в stdout события запуска и остановки, обработанные и упавшие Telegram updates, этапы регистрации, результаты retention и необработанные ошибки процесса. В записи запроса автоматически добавляются correlation ID, Telegram update ID и Telegram ID пользователя. Значения полей анкеты и полный Telegram payload в stdout не выводятся: их следует смотреть только через защищённый аудит в PostgreSQL.

Обработчики `uncaughtException` и `unhandledRejection` записывают fatal-событие, после чего приложение закрывает long polling и соединение с БД. Docker с политикой `restart: unless-stopped` затем перезапустит контейнер.

## Проверки

```powershell
npm test
npm run test:ci
npm run test:integration
npm run test:all
npm run typecheck
npm run build
```

`npm test` запускает быстрые unit-тесты без внешних сервисов. `npm run test:ci` дополнительно формирует покрытие выбранных чистых модулей в каталоге `coverage/` и проверяет порог 100%. Это не покрытие всего приложения: репозитории и SQL проверяются отдельным интеграционным набором.

`npm run test:integration` собирает изолированный Docker Compose stack с PostgreSQL 16 и тестовым Node-контейнером. База хранится в `tmpfs`, не публикует порт на хост и полностью удаляется после прогона. Команда работает на Linux и на Windows через установленную `Ubuntu-24.04` WSL2. `npm run test:all` последовательно запускает оба уровня.

### Как читать интеграционные тесты

Основные сценарии находятся в `tests/integration/database.integration.test.ts` и используют обычную структуру Arrange → Act → Assert:

1. **Arrange** — очистить таблицы и создать исходные записи;
2. **Act** — вызвать production-функцию миграции, seed, retention или регистрации;
3. **Assert** — прочитать реальное состояние PostgreSQL и проверить результат.

`beforeAll` один раз применяет настоящие миграции. `beforeEach` делает `TRUNCATE ... RESTART IDENTITY CASCADE`, поэтому тесты не зависят от порядка выполнения. `afterAll` закрывает соединение. Сам runner всегда выполняет `docker compose down --volumes`, даже после упавшего теста.

Интеграционные сценарии проверяют:

- повторное применение миграций;
- идемпотентный seed и сохранение существующего профиля администратора;
- SQL-очистку аудита на точной границе трёх календарных лет;
- создание аккаунта, назначение роли, correlation ID и audit diff;
- откат регистрации, если audit insert ломает транзакцию.

Unit-тест логгера использует секреты-приманки и проверяет, что токен, пароль и `DATABASE_URL` отсутствуют в итоговой JSON-строке даже внутри вложенного stack trace.

## CI

Workflow `.github/workflows/ci.yml` подготовлен для GitHub Actions. После публикации репозитория он будет запускаться на каждый push, pull request и вручную через `workflow_dispatch`.

CI использует два независимых job. Unit job последовательно выполняет:

1. `npm ci` по зафиксированному `package-lock.json`;
2. проверку типов;
3. Jest-тесты с покрытием;
4. production-сборку;
5. аудит production-зависимостей с порогом `high`.

Integration job запускает `npm run test:integration` с отдельным PostgreSQL 16 через Compose. Разделение сделано намеренно: unit-тесты отвечают за быструю проверку логики, integration-тесты — за реальные контракты драйвера, SQL, миграций и транзакций.

Для работы этого workflow секреты бота и базы не нужны: тесты не обращаются к Telegram или PostgreSQL. Пока репозиторий не опубликован на GitHub, файл просто лежит локально и никого не заставляет логиниться — цивилизация переживёт.

## Структура

- `src/bot.ts` — Telegram-команды, сообщения и callback-кнопки;
- `src/registration/` — сценарий регистрации, валидация и доступ к данным;
- `src/audit/` — diff, запись аудита и retention-worker;
- `src/observability/` — correlation context и Pino logger;
- `src/db/schema.ts` — схема Drizzle ORM;
- `src/db/migrate.ts` — запуск SQL-миграций;
- `src/db/seed.ts` — роли, права и главный администратор;
- `drizzle/` — версионируемые миграции;
- `docker-compose.yml` — приложение и PostgreSQL для локального запуска;
- `docker-compose.integration.yml` — изолированное окружение integration-тестов;
- `tests/integration/` — Jest-тесты с настоящей PostgreSQL;
- `scripts/run-integration-tests.mjs` — запуск и гарантированная очистка тестового Compose stack;
- `.github/workflows/ci.yml` — проверки GitHub Actions.
