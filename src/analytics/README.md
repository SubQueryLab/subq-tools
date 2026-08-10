# Модуль `analytics`

Модуль для отправки аналитических событий в **Яндекс.Метрику** через API `/collect/`.

## Экспортируемые сущности

| Сущность              | Описание                                       |
| --------------------- | ---------------------------------------------- |
| `Counter`             | Класс для логирования событий в Яндекс.Метрику |
| `YandexLoggedEvent`   | Базовый интерфейс события                      |
| `YandexPageViewEvent` | Интерфейс события просмотра страницы           |
| `YandexInternalEvent` | Интерфейс пользовательского события            |

## Использование

```typescript
import { Counter } from "./analytics";

const counter = new Counter(
  "https://example.com", // origin — используется для преобразования относительных URL
  "your-token", // token (ms) — токен счётчика
  "12345678", // targetId (tid) — идентификатор счётчика
  "user-client-id", // clientId (cid) — идентификатор посетителя
);

// Отправка события просмотра страницы
await counter.logEvent({
  type: "pageView",
  url: "/dashboard",
  refer: "https://google.com",
  header: "Dashboard",
});

// Отправка пользовательского события
await counter.logEvent({
  type: "event",
  action: "button_click",
  url: "/dashboard",
  params: { button: "subscribe" },
});
```

## Интерфейсы

### `YandexLoggedEvent`

Базовый интерфейс для всех событий:

| Поле       | Тип                                  | Описание                             |
| ---------- | ------------------------------------ | ------------------------------------ |
| `targetId` | `string`                             | Идентификатор счётчика Метрики (tid) |
| `clientId` | `string`                             | Идентификатор клиента (cid)          |
| `type`     | `'pageView'` \| `'event'`            | Тип события (t)                      |
| `params`   | `object` \| `string` _(опционально)_ | Дополнительные параметры события     |
| `at`       | `string` _(опционально)_             | Время события (et)                   |
| `token`    | `string`                             | Токен счётчика (ms)                  |

### `YandexPageViewEvent`

Событие просмотра страницы (`type: 'pageView'`):

| Поле     | Тип      | Описание                |
| -------- | -------- | ----------------------- |
| `refer`  | `string` | Реферер (dr)            |
| `url`    | `string` | URL страницы (dl)       |
| `header` | `string` | Заголовок страницы (dt) |

### `YandexInternalEvent`

Пользовательское событие (`type: 'event'`):

| Поле     | Тип                      | Описание          |
| -------- | ------------------------ | ----------------- |
| `url`    | `string` _(опционально)_ | URL страницы (dl) |
| `action` | `string`                 | Действие (ea)     |

## Класс `Counter`

### Конструктор

```typescript
new Counter(origin, token, targetId, clientId);
```

| Параметр   | Тип      | Описание                                                                                            |
| ---------- | -------- | --------------------------------------------------------------------------------------------------- |
| `origin`   | `string` | Базовый URL — используется для преобразования относительных путей в абсолютные при отправке событий |
| `token`    | `string` | Токен счётчика                                                                                      |
| `targetId` | `string` | Идентификатор счётчика Метрики                                                                      |
| `clientId` | `string` | Идентификатор посетителя                                                                            |

### Метод `logEvent`

```typescript
async logEvent(event): Promise<void>
```

Отправляет событие в Яндекс.Метрику на эндпоинт `https://mc.yandex.ru/collect/`.

**Параметры:**

Принимает объект события без полей `token`, `targetId` и `clientId` (они подставляются автоматически из значений конструктора).

**Особенности:**

- Если `url` начинается с `/`, он автоматически преобразуется в абсолютный URL с помощью `origin` из конструктора.
- Поле `params` автоматически сериализуется в JSON, если передан объект.
- Ошибки при отправке логируются в консоль, но не выбрасываются наружу.

**Пример запроса:**

Для события просмотра страницы формируется GET-запрос:

```
https://mc.yandex.ru/collect/?tid=<targetId>&cid=<clientId>&ms=<token>&t=pageView&params={<json>}&dr=<refer>&dl=<url>&dt=<header>
```

Для пользовательского события:

```
https://mc.yandex.ru/collect/?tid=<targetId>&cid=<clientId>&ms=<token>&t=event&params={<json>}&dl=<url>&ea=<action>&et=<at>
```
