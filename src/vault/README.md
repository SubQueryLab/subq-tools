# Модуль `vault`

Модуль для работы с **HashiCorp Vault** — чтение секретов из KV-хранилища и инжект их в окружение.

## Экспортируемые сущности

| Сущность                | Описание                                                        |
| ----------------------- | --------------------------------------------------------------- |
| `Vault`                 | Основной класс для подключения к Vault и работы со скоупами     |
| `KV`                    | Класс для операций с конкретным KV-движком (list, read, create) |
| `Config`                | Интерфейс конфигурации подключения                              |
| `Scope`                 | Интерфейс скоупа (kv + путь к секрету)                          |
| `getConfig`             | Читает конфиг из `secrets.config.yaml`                          |
| `getConfigFromEnv`      | Читает конфиг из переменной окружения                           |
| `getConfigWithFallback` | Приоритет: `.env` → `secrets.config.yaml`                       |
| `parseConnectionString` | Парсит connection string в объект `Config`                      |
| `envStringify`          | Сериализует объект в формат `.env` (`KEY='value'`)              |

---

## Способы конфигурации

Модуль поддерживает **два** источника конфигурации (с приоритетом):

1. **Переменная окружения `VAULT_SECRETS_URL`** (connection string)
2. **YAML-файл** — `secrets.config.yaml`

### 1. Connection string через `.env`

Создайте файл `.env` в корне проекта:

```env
VAULT_SECRETS_URL=http://admin:secret@localhost:8200?app=secret:/app&db=database:/db
```

Формат строки:

```
protocol://username:password@host?scopeName=kv:path&otherScope=kv:path
```

Где:

| Компонент           | Описание                                               |
| ------------------- | ------------------------------------------------------ |
| `protocol`          | `http` или `https`                                     |
| `username:password` | Логин и пароль для Vault. Спецсимволы URL-кодируются   |
| `host`              | Хост и порт Vault (`localhost:8200`)                   |
| `scopeName=kv:path` | Query-параметр: имя скоупа, KV-движок и путь к секрету |

> **Приоритет:** если `VAULT_SECRETS_URL` задана, YAML-файл игнорируется.

### 2. YAML-конфиг `secrets.config.yaml`

```yaml
host: http://localhost:8200
auth:
  username: admin
  password: secret
scopes:
  app:
    kv: secret
    path: /app
  db:
    kv: database
    path: /db
```

| Поле                 | Описание                                  |
| -------------------- | ----------------------------------------- |
| `host`               | URL Vault                                 |
| `auth.username`      | Логин                                     |
| `auth.password`      | Пароль                                    |
| `scopes`             | Словарь скоупов — произвольное количество |
| `scopes.<name>.kv`   | Имя KV-движка в Vault                     |
| `scopes.<name>.path` | Путь к секрету внутри KV                  |

---

## Использование

### Инициализация Vault (авто-конфиг)

```typescript
import { Vault } from "./vault";

const vault = new Vault();
await vault.init();

// Работа с конкретным KV
const appKV = vault.getKV("secret");
const secrets = await appKV.read("/app");
console.log(secrets); // { API_KEY: "...", DB_URL: "..." }
```

Конструктор `new Vault()` без аргументов автоматически вызывает `getConfigWithFallback()`:

- Если есть `VAULT_SECRETS_URL` → использует connection string
- Иначе → читает `secrets.config.yaml`

### С явной передачей Config

```typescript
import { Vault } from "./vault";
import type { Config } from "./vault/types";

const config: Config = {
  host: "http://localhost:8200",
  auth: { username: "admin", password: "secret" },
  scopes: {
    app: { kv: "secret", path: "/app" },
  },
};

const vault = new Vault(config);
await vault.init();
```

### Чтение всех скоупов сразу

```typescript
const allSecrets = await vault.getAll();
// {
//   app: { API_KEY: "..." },
//   db:  { DB_URL: "..." }
// }
```

---

## Класс `Vault`

### Конструктор

```typescript
new Vault(config?);
```

| Параметр | Тип      | Описание                                                          |
| -------- | -------- | ----------------------------------------------------------------- |
| `config` | `Config` | _(опционально)_ Конфигурация. Если не передана — авто-определение |

### Метод `init`

```typescript
async init(): Promise<void>
```

Авторизуется в Vault через `loginWithUserpass`, получает `client_token` и сохраняет соединение.

### Метод `getKV`

```typescript
getKV(kv: string): KV
```

Возвращает экземпляр `KV` для указанного движка.

**Параметры:**

| Параметр | Тип      | Описание      |
| -------- | -------- | ------------- |
| `kv`     | `string` | Имя KV-движка |

### Метод `getAll`

```typescript
async getAll(): Promise<Record<string, Record<string, string>>>
```

Читает все секреты по всем скоупам из конфига и возвращает их в виде вложенного объекта.

---

## Класс `KV`

Получается через `vault.getKV(kvName)`. Не создаётся напрямую.

### Метод `list`

```typescript
async list(path?: string): Promise<string[]>
```

Возвращает список ключей секретов по указанному пути.

### Метод `read`

```typescript
async read(name: string): Promise<Record<string, string>>
```

Читает конкретный секрет по имени.

### Метод `create`

```typescript
async create(name: string, obj: Record<string, unknown>): Promise<unknown>
```

Создаёт новый секрет.

### Метод `update`

```typescript
async update(name: string, obj: Record<string, unknown>, version?: number): Promise<unknown>
```

Обновляет существующий секрет.

---

## Утилиты парсера

### `parseConnectionString`

```typescript
import { parseConnectionString } from "./vault/parser";

const config = parseConnectionString(
  "http://admin:secret@localhost:8200?app=secret:/app",
);
// { host: "http://localhost:8200", auth: {...}, scopes: {...} }
```

### `getConfigWithFallback`

```typescript
import { getConfigWithFallback } from "./vault/parser";

// Попробует VAULT_SECRETS_URL, затем secrets.config.yaml
const config = getConfigWithFallback("custom.config.yaml");
```

---

## CLI: `sq-inject`

Модуль включает CLI-утилиту для инжекта секретов из Vault в дочерние процессы:

```bash
npx sq-inject in <команда>
```

Команда запускается с уже инжектированными секретами в `env`. Все дочерние процессы (включая цепочки `&&`, `||`, пайпы `|`) наследуют переменные окружения.

### Примеры

**Простая команда:**

```bash
npx sq-inject in npx prisma generate
```

**Цепочка команд (`&&`, `||`):**

```bash
npx sq-inject in npx prisma@7.1.0 generate && cross-env NODE_OPTIONS="--max-old-space-size=8192" NODE_ENV=dev vite dev --port=8080
```

**Пайп:**

```bash
npx sq-inject in cat .env | grep API_KEY
```

> При наличии shell-операторов (`&&`, `||`, `|`, `;`, `>`, `>>`, `<`, `<<`) sq-inject автоматически запускает команду через системный shell, поэтому вся цепочка выполняется в едином окружении с секретами.

### Как это работает

1. Загружает `.env` файл (если есть)
2. Определяет конфиг (`VAULT_SECRETS_URL` → fallback на YAML)
3. Подключается к Vault и получает токен
4. Читает все скоупы
5. Сливает секреты в единый `env`-объект
6. Запускает переданную команду с прокинутым `env` через `execa`
7. Передаёт вывод, сигналы (`SIGINT`, `SIGTERM`) и exit code родительскому процессу
