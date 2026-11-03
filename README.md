<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="@subq/tools — утилиты для внешних сервисов: аналитика и секреты из Vault">
</p>

`@subq/tools` — набор утилит для проектов SubQuery: `analytics` отправляет события в Яндекс.Метрику, а `vault` читает секреты из HashiCorp Vault и умеет подставлять их в окружение команды.

<img src="./assets/readme/section-modules.svg" width="100%" alt="Модули">

| Модуль                                      | Назначение                                                     |
| ------------------------------------------- | -------------------------------------------------------------- |
| [📊 `analytics`](./src/analytics/README.md) | Отправка аналитических событий в Яндекс.Метрику                |
| [🔐 `vault`](./src/vault/README.md)         | Чтение секретов из HashiCorp Vault и CLI `sq-inject` для инжекта в окружение |

<img src="./assets/readme/section-install.svg" width="100%" alt="Установка">

```bash
pnpm add @subq/tools
# или
npm install @subq/tools
```

<img src="./assets/readme/section-quickstart.svg" width="100%" alt="Быстрый старт">

CLI `sq-inject` запускает команду, заранее подставив в её окружение секреты из Vault:

```bash
npx sq-inject in "prisma generate"
```

Дочерние процессы наследуют эти переменные, поэтому цепочки через `&&`, `||` и пайпы тоже получают секреты. Подробнее о конфигурации — в [README модуля `vault`](./src/vault/README.md).

<img src="./assets/readme/section-development.svg" width="100%" alt="Разработка">

```bash
pnpm install
pnpm test
pnpm build
pnpm typecheck
```

## Лицензия

MIT