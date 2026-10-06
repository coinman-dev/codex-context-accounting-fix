[English](/README.md) | [Русский](/README.ru_RU.md)

# Codex: исправление учёта контекста

[![Codex 0.160.0](https://img.shields.io/badge/Codex-0.160.0-10A37F.svg)](#автоматическая-установка-windows-и-wsl2)
[![Windows | Ubuntu/WSL2](https://img.shields.io/badge/Windows%20%7C%20Ubuntu%2FWSL2-x64-0078D4.svg)](#установка)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

**codex-context-accounting-fix** исправляет преждевременное сжатие в **Codex 0.159.2 и 0.160.0** на Windows и Ubuntu/WSL2. В **prerelease 0.160.0** доступны пересобранные программы и PowerShell-установщик для Zed и терминала. Исправление предотвращает повторный учёт сохранённых рассуждений.

Здесь хранятся исходники для воспроизведения. Программы распространяются через GitHub Releases; каталоги моделей, журналы и данные учётной записи не публикуются.

## Автоматическая установка: Windows и WSL2

Скачайте и запустите установщик из [v0.160.0-reasoning.1](https://github.com/coinman-dev/codex-context-accounting-fix/releases/tag/v0.160.0-reasoning.1):

```powershell
$installerPath = Join-Path $env:USERPROFILE 'install-codex-fix.ps1'
Invoke-WebRequest -UseBasicParsing https://github.com/coinman-dev/codex-context-accounting-fix/releases/download/v0.160.0-reasoning.1/install.ps1 -OutFile $installerPath
powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath
```

Запускайте от обычного пользователя Windows. Права администратора, Python в Windows и инструменты сборки Rust не нужны. Для Windows требуются x64, PowerShell 5.1+ и Node.js 20+; установщик умеет использовать Node.js из Zed. Для WSL2 требуются x86_64, Python 3, Node.js 20+, glibc 2.35+, OpenSSL 3 и libcap — подходит Ubuntu 22.04 и новее. Если Node.js не найден, один раз запустите агент Codex в Zed или установите Node.js в нужной ОС.

Команды сохраняют скрипт в пользовательскую папку и работают даже при запуске PowerShell из `C:\Windows\system32`.

Скрипт скачивает архивы нужных платформ, проверяет SHA-256 архивов и их содержимого, подготавливает обе установки и подключает исправленные файлы к штатному агенту Zed `codex-acp`. Он находит дистрибутивы WSL2 с существующим профилем Codex и пропускает служебные дистрибутивы Docker. Файлы устанавливаются в `~/.codex/context-accounting-fix/`; команда `codex` добавляется в пользовательский PATH. Скрипт сохраняет резервные копии и проверяет запуск app-server, а при наличии адаптера — ACP. Проверки создают пустые чаты и не отправляют запросов модели. Если проверка запуска не проходит, подготовленные установки откатываются.

Если вы ещё не вошли в Codex, установщик проверит запуск и сообщит, что требуется авторизация. Войдите через Zed перед началом чата. Каждая проверка дожидается завершения предыдущего процесса, прежде чем снова открыть тот же профиль SQLite.

Настройки размера контекста сохраняются; увеличение окна — отдельный выбор. После установки выберите **⋯ → Reload Agent** в Zed, когда текущая работа завершится. Для команды `codex` откройте новый терминал. Явный путь к программе, alias или функция оболочки, а также более приоритетный системный PATH могут выбирать другой Codex; выбор можно проверить через `Get-Command codex -All` / `type -a codex`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath -WindowsOnly
powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath -WslOnly -Distro Ubuntu
powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath -SkipCli
powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath -SkipZed
powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath -Check
powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath -Rollback
```

Откат восстанавливает прежние файлы, в том числе ранее установленное локальное исправление. Если после установки файл редактировали вручную, откат останавливается, сохраняя эти изменения. Официальные программы остаются доступны по прежним путям. Резервные копии и записи установки находятся в `~/.codex/context-accounting-fix/transactions/` каждой ОС. Для установки без сети скачайте `release.json`, `install-helper.cjs`, `preload.cjs` и ZIP нужных платформ из одного релиза в одну папку, затем укажите `-AssetDirectory C:\путь\к\папке`.

Архивы содержат служебные файлы официальных npm-пакетов 0.160.0, проверенных по SHA-512 npm, исправленный Codex и патч исходников. SQL-миграции Windows приведены к CRLF, чтобы совпадать с контрольными суммами официальных Windows-баз. Обе программы prerelease собраны локально в WSL2: Windows через `cargo-xwin`, Linux в окружении Ubuntu 22.04. Максимальное требование Linux-бинарника к glibc — `GLIBC_2.35`. Скрипты сборки закрепляют исходники `a956835d020762cb2b570053af06f643a11c0ecc` и проверяют файлы V8 по контрольным суммам из исходного дерева.

## Почему compact срабатывал раньше времени

В режиме `reasoning.context = all_turns` сервер уже включает сохранённые рассуждения в `input_tokens`. При отсутствии заголовка `x-reasoning-included` Codex повторно оценивал те же рассуждения и запускал compact раньше полного контекста.

В исследованном чате индикатор Zed показывал 737 658 токенов. Codex добавлял оценку 313 149 токенов прошлых рассуждений и 946 токенов новых результатов инструментов, что давало 1 051 753 при пределе 1 050 000. См. [отчёт об аналогичной ошибке](https://github.com/openai/codex/issues/39767).

## Что делает патч

Патч определяет учёт по режиму запроса, сохраняет признак предыдущего ответа до проверки перед новым ходом и пересчитывает его для модели фактического запроса. Содержимое истории не меняется. У моделей, для которых сервер не учитывает старые рассуждения, прежний расчёт сохраняется.

## Состав репозитория

| Файл | Назначение |
| --- | --- |
| [`install.ps1`](install.ps1) | Скачивание и установка prerelease в Windows и WSL2, проверка и откат |
| [`scripts/install-helper.cjs`](scripts/install-helper.cjs) | Проверка файлов, правка JSONC-настроек Zed и транзакции установки |
| [`.github/workflows/build-prerelease.yml`](.github/workflows/build-prerelease.yml) | Сборка Windows/Linux 0.160.0 и проверки расчёта контекста |
| [`patches/codex-0.159.2-reasoning-accounting.patch`](patches/codex-0.159.2-reasoning-accounting.patch) | Патч для исходников Codex |
| [`bootstrap/preload.cjs`](bootstrap/preload.cjs) | Переносимый загрузчик: направляет штатный агент `codex-acp` на установленный файл |
| [`scripts/install.py`](scripts/install.py) | Установщик |
| [`scripts/enable.ps1`](scripts/enable.ps1) | Включение исправления в Zed |
| [`scripts/probe.cjs`](scripts/probe.cjs) | Проверка запуска через штатный адаптер ACP |
| [`scripts/fetch-vendor.py`](scripts/fetch-vendor.py) | Загрузка официального пакета |
| [`scripts/prepare-windows-migrations.py`](scripts/prepare-windows-migrations.py) | Смена окончаний строк в SQL-миграциях перед сборкой Windows |
| [`scripts/replace-windows.py`](scripts/replace-windows.py) | Замена исполняемого файла установленной Windows-сборки |
| [`scripts/create-catalog.py`](scripts/create-catalog.py) | Генератор каталога моделей |

## Сборка

Автоматическая сборка 0.160.0 описана в workflow выше. Команды ниже относятся к исходной локальной сборке 0.159.2; один патч применяется к обеим версиям.

Клонируйте [OpenAI Codex](https://github.com/openai/codex) с тегом `rust-v0.159.2` и примените патч в корне его исходников:

```bash
git clone --depth 1 --branch rust-v0.159.2 https://github.com/openai/codex.git codex-0.159.2
cd codex-0.159.2
git apply /path/to/codex-context-accounting-fix/patches/codex-0.159.2-reasoning-accounting.patch
cd codex-rs
```

Патч без изменений накладывается и на тег `rust-v0.160.0`.

Используйте Rust 1.98.1, `just` и `cargo-nextest`. Для Windows также нужны цель `x86_64-pc-windows-msvc`, `cargo-xwin`, Clang/LLD и CMake. Первый запуск Cargo обновит локальные версии пакетов в `Cargo.lock` исходного тега; зависимости при этом остаются закреплёнными. Профиль, использованный для проверки:

```bash
export RUSTUP_TOOLCHAIN=1.98.1
export CARGO_PROFILE_RELEASE_LTO=false
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
export CARGO_PROFILE_RELEASE_OPT_LEVEL=2
export CARGO_PROFILE_RELEASE_STRIP=debuginfo
cargo build --release -p codex-cli --bin codex
# Перед сборкой Windows запустите scripts/prepare-windows-migrations.py
# из этого репозитория с --codex-rs /path/to/codex-0.159.2/codex-rs.
cargo xwin build --release --locked -p codex-cli --bin codex --target x86_64-pc-windows-msvc
```

Полученные файлы: `target/release/codex` для Ubuntu и `target/x86_64-pc-windows-msvc/release/codex.exe` для Windows. Для полного рабочего комплекта скопируйте рядом с ними служебные файлы официального пакета соответствующей версии. `scripts/fetch-vendor.py --platform windows` и `--platform linux` загружают официальные npm-пакеты 0.159.2 и проверяют SHA-512. Директория загрузки `build/` исключена из Git.

### Windows и SQLite

Windows-пакет Codex был собран с CRLF в SQL-миграциях, а у исходников, полученных через Git в Ubuntu, обычно LF. SQLx вычисляет контрольные суммы по точным байтам SQL. Поэтому сборка Windows из LF-исходников отвергает уже существующую Windows-базу SQLite, хотя сама база цела.

После сборки Linux переведите миграции на CRLF и только затем соберите Windows:

```bash
python scripts/prepare-windows-migrations.py --codex-rs /path/to/codex-0.159.2/codex-rs --mode crlf
```

Для повторной сборки Linux верните `--mode lf`. Скрипт меняет окончания строк только в шести каталогах миграций и заставляет Cargo пересобрать включающий их модуль. Пользовательские базы SQLite изменять не требуется.

## Установка

Установка выполняется отдельно в каждой ОС:

```bash
python scripts/install.py --binary ПУТЬ_К_ФАЙЛУ --vendor-root ПУТЬ_К_VENDOR --patch patches/codex-0.159.2-reasoning-accounting.patch --preload bootstrap/preload.cjs
```

Установщик создаёт отдельную версию в `~/.codex/context-accounting-fix/`, проверяет хеш исполняемого файла и формирует одинаковую для обеих ОС опцию запуска. Существующие файлы официального Codex он не заменяет.

После успешной установки в Windows и Ubuntu выполните `scripts/enable.ps1` в PowerShell. Скрипт проверяет результаты `scripts/probe.cjs` из обеих ОС и добавляет в **штатный** агент `codex-acp` одну переменную окружения. Резервная копия `settings.json` создаётся рядом с ним. Для уже открытого проекта Zed выберите `⋯` в панели чата → **Reload Agent**, когда текущая задача завершится. Перезапуск редактора не требуется. Выбор модели и прочие настройки Codex сохраняются.

Если более ранняя Windows-сборка из LF-исходников уже установлена, замените только её исполняемый файл:

```bash
python scripts/replace-windows.py --binary ПУТЬ_К_НОВОМУ_codex.exe
```

Скрипт проверяет версию и контрольные суммы, сохраняет прежний файл в той же папке, затем обновляет `current.json`. Запускайте проверку ACP и включайте настройку Zed после успешной замены.

## Размер окна

Исправление учёта не меняет окно и работает со стандартными настройками. Увеличенное окно — отдельный необязательный выбор.

Окно 1 050 000 токенов, которое OpenAI указывает для моделей GPT-6 и GPT-5.6, делится на вход и ответ: [документация модели](https://developers.openai.com/api/docs/models/gpt-6.1-sol) называет максимум входа 922 000 и максимум ответа 128 000. История чата в Codex целиком относится ко входу, поэтому её предел — 922 000, а не 1 050 000.

### В пределах серверного каталога

Серверный каталог Codex даёт этим моделям `max_context_window = 872000` при `effective_context_window_percent = 95`, а `model_context_window` выше этого максимума не поднимается. Свой каталог для этого не нужен, достаточно настроек в `~/.codex/config.toml`:

```toml
model_context_window = 872000
model_auto_compact_token_limit = 872000
model_auto_compact_token_limit_scope = "body_after_prefix"
model_post_turn_compact_threshold_percent = 0
```

Compact при этом запускается при 828 400 токенах (95% от 872 000), до предела входа остаётся 93 600 токенов.

### За пределами серверного каталога

> [!CAUTION]
> Эта настройка выходит за рамки серверного каталога и не поддерживается OpenAI. Команда Codex [рекомендует стандартные настройки окна](https://github.com/openai/codex/issues/19409#issuecomment-4315638228) и [предупреждала](https://github.com/openai/codex/issues/19464#issuecomment-4364763432), что изменения на стороне клиента могут оставить чат, который невозможно сжать. Именно это произошло в проверке, описанной ниже. Применяйте её, только если принимаете этот риск.

Чтобы использовать весь документированный вход, создайте локальный каталог:

```bash
python scripts/create-catalog.py
```

Скрипт копирует список моделей из `~/.codex/models_cache.json` и задаёт у семи моделей GPT-6 и GPT-5.6 два поля: `max_context_window` становится 922 000, а `effective_context_window_percent` — 95, как и в серверном каталоге. Прочие модели он не трогает. Каталог в Git не включён, потому что он привязан к версии клиента и доступу учётной записи; после появления новых моделей создайте его заново.

Укажите каталог в настройках и поднимите оба значения:

```toml
model_catalog_json = "/home/USER/.codex/codex-1m/catalog.json"
model_context_window = 922000
model_auto_compact_token_limit = 922000
model_auto_compact_token_limit_scope = "body_after_prefix"
model_post_turn_compact_threshold_percent = 0
```

Compact при этом запускается при 875 900 токенах (95% от 922 000), и эта же величина служит знаменателем индикатора контекста в Zed. Путь к каталогу должен быть абсолютным; в Windows он имеет вид `C:/Users/USER/.codex/codex-1m/catalog.json`. Долю задаёт константа `EFFECTIVE_PERCENT` в скрипте; после её изменения каталог нужно создать заново в каждой ОС.

### Почему порог ниже предела

> [!WARNING]
> Не убирайте запас в 46 100 токенов между порогом и пределом. После отказа сервера из-за размера запроса Codex 0.159.2 не сжимает историю сам, и чат остаётся нерабочим.

Настройка с окном 1 050 000 и долей 100% была проверена в рабочем чате GPT-6.1 Sol. Запрос на 922 856 входных токенов сервер принял, следующий, примерно на 925 000, отклонил с `context_length_exceeded`. Клиент при этом считал предел равным 1 050 000 и compact не запускал. После такого отказа Codex 0.159.2 завершает ход ошибкой «Codex ran out of room in the model's context window». Запрос compact отправляет ту же историю и упирается в тот же предел, поэтому чат остаётся нерабочим.

Клиент проверяет порог между шагами модели, а один шаг добавляет к истории рассуждения и выводы команд. В сохранённых чатах 99% шагов добавляли не больше 11 292 токенов, а два шага из 7 647 — больше запаса в 46 100: 51 897 и 90 254. Самый большой дал один ответ, который рассуждал 54 минуты, пока его не прервали; незавершённые рассуждения остались в истории. Такой шаг вблизи порога снова остановит чат. Большая доля делает это вероятнее: при 97% запас равен 27 660, и его превысили шесть шагов.

## Состояние проверок

- На 0.159.2 и на 0.160.0 проходят 7 интеграционных проверок расчёта контекста, включая восстановление сессии и оба режима порога.
- На исходниках 0.160.0 без патча четыре новых случая падают: Codex отправляет запрос compact, который патч предотвращает.
- На обеих версиях проходят 5 тестов модуля, которому потребовался увеличенный предел рекурсии компилятора.
- Полный набор тестов всего исходного дерева не запускался.
- Программы prerelease 0.160.0 собраны в WSL2 и прошли проверки app-server и штатного ACP на Windows и WSL2, в том числе на существующих авторизованных профилях, без запросов модели. Установка и откат также проверены в изолированных профилях.
- Замер рабочего чата относится к 0.159.2: после установки контекст дошёл до 922 856 входных токенов без преждевременного compact; до исправления тот же чат был сжат при 734 065.
- Срабатывание compact на заданном пороге в рабочем чате ещё не наблюдалось.

Чтобы повторить проверки, выполните в `codex-rs` исходников с патчем:

```bash
export RUST_MIN_STACK=8388608
cargo test -p codex-core --test all -- all_turns_reasoning_without_header_does_not_compact_twice auto_compact_accounts_for_encrypted_reasoning auto_compact_body_after_prefix_still_caps_at_context_window
cargo test -p codex-chatgpt
```

Размер стека взят из собственного рецепта тестов проекта; без него неоптимизированный тестовый файл переполняет стек.
