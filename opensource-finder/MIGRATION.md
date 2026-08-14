# История переименований

Скилл сменил имя дважды:

| Было | Стало | Что изменилось |
| --- | --- | --- |
| `github-solution-research` | `pavedpath-code` | Переименование и репозиционирование в апстриме |
| `pavedpath-code` | `opensource-finder` | Этот форк: контент на русском, имя совпадает с именем репозитория, добавлен раздел нативных инструментов OMP |

Поведение скилла сохранено во всех переименованиях: постановка задачи первой, GitHub CLI как основа поиска, ранжирование доказательств, минимальная локальная адаптация и обязательная проверка.

- Текущее имя скилла: `opensource-finder`
- Отображаемое имя: `Opensource Finder`
- Апстрим: [Jia-Ethan/pavedpath-code](https://github.com/Jia-Ethan/pavedpath-code)

## Установка на замену старой версии

Один каталог активных скиллов не должен содержать несколько имён этого скилла одновременно: рантайм может рекурсивно загрузить оба и получить конфликт инструкций.

```bash
rm -rf ~/.omp/agent/skills/pavedpath-code ~/.omp/agent/skills/github-solution-research
git clone https://github.com/I1eanch/opensource-finder.git \
  ~/.omp/agent/skills/opensource-finder
```

Для других рантаймов путь заменить на свой каталог активных скиллов, например `~/.codex/skills/opensource-finder`.

Проверка после установки:

```bash
omp -p --no-session 'Прочитай skill://opensource-finder и выведи значение поля name.'
```
