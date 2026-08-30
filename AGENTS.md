# Правила работы с репозиторием

## Git Flow

- `main` содержит только стабильные, готовые к развёртыванию версии.
- `develop` — интеграционная ветка для следующего релиза.
- Новую работу начинай от `develop` в ветках `feature/<краткое-имя>`.
- Срочные исправления production начинай от `main` в `hotfix/<краткое-имя>` и вливай в `main` и `develop`.
- Подготовку релиза веди в `release/<версия>`; после проверки вливай в `main` и обратно в `develop`.
- `bugfix/<краткое-имя>` используй для исправлений, найденных в разработке.
- Не коммить напрямую в `main` и `develop`: используй pull request после проверки изменений.

## Conventional Commits

- Заголовок каждого коммита должен иметь формат: `<type>(<scope>): <описание>`.
- Допустимые типы: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- `scope` необязателен, описание — в повелительном наклонении, с маленькой буквы, без точки в конце.
- Для несовместимого изменения добавляй `!` перед двоеточием и объяснение в footer `BREAKING CHANGE:`.
- Примеры: `feat(bot): add registration command`, `fix(db): close connection on shutdown`, `chore: update dependencies`.
- Локальный hook `.githooks/commit-msg` проверяет этот формат. После нового clone выполни `git config core.hooksPath .githooks`.

## Перед PR и деплоем

- Не добавляй в Git `.env`, токены, пароли, дампы БД и прочие секреты.
- Перед PR запусти `npm run typecheck` и `npm test`; для изменений интеграции — `npm run test:integration`.
- Обновляй README, если меняются запуск, окружение, Docker или публичное поведение приложения.
