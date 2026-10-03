# Codex: исправление учёта контекста

Локальное исправление для **Codex 0.159.2** в Zed на Windows и Ubuntu/WSL. В режиме `reasoning.context = all_turns` сервер уже включает сохранённые рассуждения в `input_tokens`. При отсутствии заголовка `x-reasoning-included` Codex повторно оценивал те же рассуждения и запускал compact раньше полного контекста. В исследованном чате индикатор Zed показывал 737 658 токенов, а Codex добавлял оценку 313 149 токенов прошлых рассуждений и 946 токенов новых результатов инструментов: 1 051 753 при пределе 1 050 000. См. [отчёт об аналогичной ошибке](https://github.com/openai/codex/issues/39767).

Патч определяет учёт по режиму запроса, сохраняет признак предыдущего ответа до проверки перед новым ходом и пересчитывает его для модели фактического запроса. Содержимое истории не меняется. У моделей, для которых сервер не учитывает старые рассуждения, прежний расчёт сохраняется.

Репозиторий содержит только исходники для воспроизведения: [патч](patches/codex-0.159.2-reasoning-accounting.patch), переносимый [загрузчик](bootstrap/preload.cjs), [установщик](scripts/install.py), [включение в Zed](scripts/enable.ps1), [проверку запуска](scripts/probe.cjs), [загрузку официального пакета](scripts/fetch-vendor.py) и [генератор каталога моделей](scripts/create-catalog.py). Собранные программы, каталоги моделей, журналы и данные учётной записи здесь не хранятся.

Для повторной сборки клонируйте [OpenAI Codex](https://github.com/openai/codex) с тегом `rust-v0.159.2` и примените патч в корне его исходников:

```bash
git clone --depth 1 --branch rust-v0.159.2 https://github.com/openai/codex.git codex-0.159.2
cd codex-0.159.2
git apply /path/to/codex-context-accounting-fix/patches/codex-0.159.2-reasoning-accounting.patch
cd codex-rs
```

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

**Windows и SQLite:** Windows-пакет Codex был собран с CRLF в SQL-миграциях; у исходников, полученных через Git в Ubuntu, обычно LF. SQLx вычисляет контрольные суммы по точным байтам SQL. Поэтому сборка Windows из LF-исходников отвергает уже существующую Windows-базу SQLite, хотя сама база цела. После сборки Linux выполните `python scripts/prepare-windows-migrations.py --codex-rs /path/to/codex-0.159.2/codex-rs --mode crlf` и только затем соберите Windows. Для повторной сборки Linux верните `--mode lf`. Скрипт меняет окончания строк только в шести каталогах миграций и заставляет Cargo пересобрать включающий их модуль. Пользовательские базы SQLite изменять не требуется.

Если более ранняя Windows-сборка уже установлена с LF, замените только её исполняемый файл командой `python scripts/replace-windows.py --binary ПУТЬ_К_НОВОМУ_codex.exe`. Скрипт проверяет версию и контрольные суммы, сохраняет прежний файл в той же папке, затем обновляет `current.json`. Запускайте проверку ACP и включайте настройку Zed после успешной замены.

Установка выполняется отдельно в каждой ОС командой `python scripts/install.py --binary ПУТЬ_К_ФАЙЛУ --vendor-root ПУТЬ_К_VENDOR --patch patches/codex-0.159.2-reasoning-accounting.patch --preload bootstrap/preload.cjs`. Установщик создаёт отдельную версию в `~/.codex/context-accounting-fix/`, проверяет хеш исполняемого файла и формирует одинаковую для обеих ОС опцию запуска. Существующие файлы официального Codex он не заменяет.

После успешной установки в Windows и Ubuntu выполните `scripts/enable.ps1` в PowerShell. Скрипт проверяет результаты `scripts/probe.cjs` из обеих ОС и добавляет в **штатный** `codex-acp` одну переменную окружения. Резервная копия `settings.json` создаётся рядом с ним. Для уже открытого проекта Zed выберите `⋯` в панели чата → **Reload Agent**, когда текущая задача завершится. Перезапуск редактора не требуется. Выбор модели и прочие настройки Codex сохраняются.

Каталог моделей в Git не включён, потому что он привязан к версиям и доступу учётной записи. На чистой установке можно создать его через `python scripts/create-catalog.py`, а в `~/.codex/config.toml` использовать `model_catalog_json = "~/.codex/codex-1m/catalog.json"`. Размер окна и порог compact остаются выбором пользователя. Каталог влияет на ограничения клиента; он не увеличивает серверный предел модели.

Проверено: 7 интеграционных проверок расчёта контекста, включая восстановление сессии и оба режима порога; 5 тестов модуля, которому потребовался увеличенный предел типов компилятора. Полный набор тестов всего исходного дерева не запускался. Крупный серверный запрос на 1,05 млн токенов также не выполнялся.
