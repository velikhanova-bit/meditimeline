---
name: ios-testflight
description: Нативный путь к L1 — SwiftUI-каркас, иконка, архив и билд в TestFlight у внутреннего тестера. Использовать, когда просят «нативное приложение», «SwiftUI», «TestFlight», «собрать билд», «залить в тестфлайт», или когда продукт по замыслу не сводится к веб-странице. Не для App Store: публикация в стор в день не входит.
---

# ios-testflight — от пустого проекта до билда на чужом телефоне

Урезанная версия `/ios-app`: только каркас и TestFlight. Фаза research, скан на причины отказа при ревью и публикация в стор выброшены — внутреннему тестированию ревью не нужно, а лишние фазы съедают день.

L1 нативного пути: **билд обработан и стоит на телефоне внутреннего тестера.** Не «собирается в Xcode», не «работает в симуляторе».

## Прежде чем начать

Проверь одной командой, что путь вообще открыт:

```bash
xcodegen --version && xcodebuild -version && asc apps list
```

Если хоть что-то из этого не отвечает — нативный путь сегодня закрыт, бери `starters/pwa`. Разбираться с сертификатами в 12:00 значит потерять день.

## 1. Каркас (20 минут)

```bash
mkdir <AppName> && cd <AppName>
cp .claude/skills/ios-testflight/templates/project.yml .
```

Замени в `project.yml` плейсхолдеры: `{{APP_NAME}}` (CamelCase), `{{BUNDLE_PREFIX}}`, `{{BUNDLE_ID}}`, `{{DISPLAY_NAME}}`, `{{CATEGORY}}`, `{{TEAM_ID}}` (10 символов, developer.apple.com → Membership).

Порядок сборки кода — строго такой, экраны последними:

1. `Theme.swift` — цвета, шрифты, отступы. Один файл, не система.
2. Модели (`@Model`, SwiftData) и заглушки сервисов. Никаких реальных API в первой версии.
3. `RootView` + навигация.
4. Экраны главного пути.

Правила Swift 6, на которых люди залипают чаще всего:

- `@Observable` ViewModel, который трогает UI, всегда помечен `@MainActor`.
- `Task {}` внутри `@MainActor`-класса: захвати зависимости в локальные `let` до `Task`, иначе получишь «sending risks data race».
- Для iOS-приложения всегда `xcodebuild`, никогда `swift build`.
- После любой правки `project.yml` — `xcodegen generate`.

Проверка:

```bash
xcodegen generate
xcodebuild -project <AppName>.xcodeproj -scheme <AppName> \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

## 2. Иконка (5 минут)

Без иконки билд соберётся, но на телефоне тестера будет серый квадрат — а первое, что человек видит, это иконка.

```bash
python3 .claude/skills/ios-testflight/templates/generate_icon.py \
  "#0f0f1a" "#c9a84c" moon <AppName>/Assets.xcassets/AppIcon.appiconset/AppIcon.png
```

Символы: `moon star leaf heart flame drop bolt eye`. Нужен `pip3 install pillow`. Пять минут на иконку — потолок, не полчаса.

## 3. Архив и заливка (15 минут + обработка)

```bash
xcodebuild -project <AppName>.xcodeproj -scheme <AppName> \
  -destination 'generic/platform=iOS' \
  -archivePath build/<AppName>.xcarchive archive

xcodebuild -exportArchive -archivePath build/<AppName>.xcarchive \
  -exportPath build/export -exportOptionsPlist ExportOptions.plist
```

`ExportOptions.plist` минимальный:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>TEAM_ID</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
```

Заливка и проверка статуса:

```bash
xcrun altool --upload-app -f build/export/<AppName>.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

asc builds list --app <bundle-id>
```

Если Xcode проще — Product → Archive → Organizer → Distribute App → App Store Connect. Результат тот же.

## 4. До тестера

Внутренняя группа и тестеры добавлены заранее, до дня. Здесь остаётся только приложить билд к группе — внутреннему тестированию ревью не нужно, билд доступен сразу после обработки.

**Обработка — единственный шаг, на который нельзя повлиять.** Обычно 5–30 минут, иногда часы. Пока идёт обработка, не сиди над ней: пиши следующий экран или текст на экране.

## Готово — это когда

1. `asc builds list` показывает билд в состоянии, доступном тестерам.
2. Тестер открыл приложение на своём телефоне и прошёл главный сценарий.
3. Не симулятор. Симулятор ничего не доказывает.

Пока пункта 2 нет — говори «билд залил, на устройстве не проверял», а не «работает».

## Если встал

- **Билд висит в Processing больше часа** — не жди. Закрывай L1 веб-версией, билд догонит.
- **«No profiles found»** — в Xcode → Signing & Capabilities → Automatically manage signing, аккаунт добавлен в Settings → Accounts.
- **Заливка отбита по версии** — подними `CURRENT_PROJECT_VERSION` в `project.yml`, `xcodegen generate`, архив заново. Номер билда должен расти при каждой заливке.
- **Больше 20 минут на одном месте** — скилл `stuck`, строка в `STUCK.md`. Это важнее билда.
