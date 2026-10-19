'use strict';

const { BUILDER_SYSTEM } = require('./system');

function withBuilder(specific) {
  return specific.trim() + '\n\n' + BUILDER_SYSTEM;
}

const templates = [
  {
    id: 'react-vite',
    name: 'React + Vite',
    category: 'Web',
    description:
      'Single-page application with React 18, TypeScript, Vite, Vitest, and Testing Library.',
    prompt:
      'Scaffold a React + Vite single-page application named after this folder. Use TypeScript with strict mode, ' +
      'React 18, Vite as the build tool and dev server, ESLint, Vitest with jsdom and @testing-library/react for tests, ' +
      'and plain CSS or CSS modules (no UI framework unless clearly justified). Create a small but real app: an App shell ' +
      'with a header, at least two routed or state-switched views, a reusable component with props, and one unit test ' +
      'for that component. Install dependencies, run the production build, and run the test suite. Fix any failures.',
    system: withBuilder(`
You are building a React + Vite web application in the current empty project folder.

Stack requirements:
- Vite as bundler and dev server; React 18 with TypeScript (tsconfig strict: true).
- Entry via index.html at project root and src/main.tsx calling createRoot.
- Vitest as the test runner with the jsdom environment, plus @testing-library/react and @testing-library/jest-dom.
- ESLint with typescript-eslint and the react-hooks plugins.
- Plain CSS or CSS modules per component; do not add Tailwind, CSS-in-JS libraries, or component kits unless the user asked.

Project layout to create:
- index.html, vite.config.ts (include vitest config: environment jsdom, setupFiles ./src/test/setup.ts), tsconfig.json, tsconfig.node.json, package.json, .gitignore, README.md.
- src/main.tsx, src/App.tsx, src/App.css or src/styles.css, src/test/setup.ts.
- src/components/ with at least one reusable presentational component (for example src/components/Counter.tsx or ItemList.tsx) and its test file next to it (Component.test.tsx).
- src/views/ or equivalent for two simple views, switched by local state or react-router-dom; add react-router-dom only if you use real routes.

Exact commands (use npm):
1. npm install  (after writing package.json with pinned major versions; alternatively generate with "npm create vite@latest . -- --template react-ts" non-interactively, then add vitest deps)
2. Dev server check is optional: npm run dev -- --host 127.0.0.1 (do not leave it running).
3. npm run build   (must succeed; Vite outputs to dist/)
4. npm test        (package.json "test": "vitest run"; must pass)
5. npm run lint    (if eslint script exists; fix reported issues)

Quality bar:
- No unused imports or variables (keep eslint clean).
- Components typed with explicit prop interfaces.
- The test must render a component and assert on visible text and an interaction (click or input).
- README.md must document: prerequisites (Node 18+), install, dev, build, test, preview commands.
`),
  },

  {
    id: 'nextjs',
    name: 'Next.js',
    category: 'Web',
    description:
      'Full-stack Next.js App Router project with TypeScript, ESLint, and Vitest.',
    prompt:
      'Scaffold a Next.js application named after this folder using the App Router, TypeScript, and ESLint. ' +
      'Include a root layout, a home page, one additional route, and one small route handler (API endpoint) with a test. ' +
      'Add Vitest for unit tests. Install dependencies, run the production build, and run tests. Fix any failures.',
    system: withBuilder(`
You are building a Next.js application in the current empty project folder.

Stack requirements:
- Next.js 14+ with the App Router (app/ directory), TypeScript strict mode, and ESLint (eslint-config-next).
- Do not use the Pages Router. Do not add a database unless asked; keep data local (in-memory or static).
- Vitest for unit tests (do not rely on next/jest if it complicates the setup; a plain vitest.config.ts with the node environment is fine for route-handler and util tests).

Prefer generating files directly. If you scaffold instead, use fully non-interactive flags, for example:
  npx create-next-app@latest . --ts --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
then adjust to match the layout below. Never pass flags that start interactive prompts.

Project layout to create:
- package.json, tsconfig.json, next.config.mjs, .eslintrc.json or eslint.config.mjs, .gitignore, README.md, vitest.config.ts.
- src/app/layout.tsx (root layout with metadata and a simple nav), src/app/page.tsx (home), src/app/about/page.tsx (second route).
- src/app/api/health/route.ts exporting async GET returning Response.json({ status: "ok" }).
- src/lib/ with at least one pure helper (for example formatRelativeTime) and a matching test in src/lib/*.test.ts.

Exact commands (use npm):
1. npm install
2. npm run build   (must succeed; fix type or lint errors surfaced by the build)
3. npm test        ("test": "vitest run"; must pass)
4. npm run lint    (fix reported issues)

Quality bar:
- "use client" only where interactivity requires it; keep server components by default.
- No emoji in code, UI strings, or README.
- README.md must document: prerequisites (Node 18+), install, dev (npm run dev), build, start (npm start), and test.
`),
  },

  {
    id: 'static-site',
    name: 'Static site',
    category: 'Web',
    description:
      'Plain HTML, CSS, and JavaScript site with no framework and no build step.',
    prompt:
      'Scaffold a static website named after this folder using only HTML, CSS, and vanilla JavaScript (no frameworks, ' +
      'no bundler, no npm dependencies). Create index.html plus one additional page, a shared stylesheet, and a small ' +
      'script module. Validate that every internal link resolves and that the HTML is well-formed, then serve the site ' +
      'briefly with a simple static server to confirm it loads.',
    system: withBuilder(`
You are building a dependency-free static website in the current empty project folder.

Stack requirements:
- Pure HTML5, CSS3, and ES modules JavaScript. No npm packages, no bundler, no framework, no CDN scripts.
- Accessible markup: semantic elements, one h1 per page, alt text on images, sufficient color contrast.
- Responsive layout with CSS custom properties for the palette and a mobile-first stylesheet.

Project layout to create:
- index.html (home) and at least one more page, for example about.html, cross-linked with relative hrefs.
- css/styles.css with a small design system: color tokens in :root, typography, layout, and a simple responsive grid or flex section.
- js/main.js as an ES module (type="module") handling one interactive behavior (for example a mobile nav toggle or a small client-side filter). Reference it from pages with <script type="module" src="js/main.js"></script>.
- assets/ directory (you may add a simple SVG logo by writing the file directly).
- robots.txt and a basic 404.html. Do not add package.json unless you truly need one; prefer none.
- README.md describing how to open the site and how to serve it locally.

Exact verification commands (no install step):
1. Confirm structure: list the created files and check every internal href/src in the HTML points to an existing file (fix any broken links).
2. Syntax-check JavaScript with: node --check js/main.js
3. Serve and smoke-test: run "python3 -m http.server 4173" or "npx --yes serve -l 4173 ." in the project root, request "/" and each page with curl (curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/), expect 200, then stop the server. If neither python3 nor npx is available, skip the server check and say so.
4. Optional HTML sanity: if tidy is installed, run "tidy -qe index.html" and fix reported errors; otherwise skip.

Quality bar:
- No emoji anywhere.
- No inline <style> or <script> blocks except tiny per-page needs; prefer external files.
- All JS in js/ must pass node --check.
`),
  },

  {
    id: 'electron',
    name: 'Electron',
    category: 'Desktop',
    description:
      'Electron desktop app with main and preload processes, a renderer, and electron-builder packaging.',
    prompt:
      'Scaffold an Electron desktop application named after this folder. Use contextIsolation with a preload script ' +
      'exposing a minimal IPC API, a plain HTML/CSS/JS renderer (no bundler), electron-builder for packaging, and ' +
      'Vitest or node:test for unit tests on the main-process logic. Install dependencies, run the tests, and run the ' +
      'production build/packaging step (or the closest verifiable step if packaging cannot complete on this machine). Fix any failures.',
    system: withBuilder(`
You are building an Electron desktop application in the current empty project folder.

Stack requirements:
- Electron as the runtime. Plain JS (or TypeScript compiled with tsc only, no bundler) for main and preload.
- securityDefaults: contextIsolation: true, nodeIntegration: false, sandbox: true if compatible with your preload; validate the window will load a local file.
- Preload uses contextBridge to expose a narrow API (for example window.api.ping() or getVersions()) via ipcRenderer.invoke; main registers matching ipcMain.handle handlers.
- electron-builder for packaging configuration in package.json (appId, productName, files, directories.output = dist).
- Unit tests with Vitest (environment node) for pure main-process helpers; do not attempt to launch Electron inside unit tests.

Project layout to create:
- package.json (main: "src/main/main.js"), .gitignore, README.md.
- src/main/main.js: app lifecycle, BrowserWindow creation (show: false then ready-to-show), loadFile of the renderer index, quit handling (app.quit on window-all-closed except darwin).
- src/main/ipc.js: registerIpc(handle) function registering at least two invoke channels.
- src/preload/preload.js: contextBridge.exposeInMainWorld("api", { ... }) with typed JSDoc.
- src/renderer/index.html, src/renderer/styles.css, src/renderer/app.js: small UI that calls window.api and renders the result; button + output element.
- src/main/ipc.test.js (or .ts): tests for the pure logic in ipc.js using vitest with a fake ipcMain.

Exact commands (use npm):
1. npm install
2. npm test        ("test": "vitest run"; must pass)
3. npm start       (optional smoke check: start Electron for a few seconds; if there is no display server, skip and note that a graphical session is required)
4. npm run build   ("build": "electron-builder --publish never" or platform-neutral equivalent; if packaging fails due to missing platform tooling, run "electron-builder --dir" and report the exact blocker)

Quality bar:
- Never use require("electron") inside renderer files.
- No auto-updater, no telemetry. No emoji.
- README.md must document: prerequisites (Node 18+), install, start, test, build, and platform notes for packaging.
`),
  },

  {
    id: 'tauri',
    name: 'Tauri',
    category: 'Desktop',
    description:
      'Tauri 2 desktop shell with a TypeScript frontend and a Rust backend.',
    prompt:
      'Scaffold a Tauri 2 desktop application named after this folder with a TypeScript web frontend (plain Vite, no ' +
      'framework required) and a small Rust backend exposing one invoke command. Include the Tauri configuration, icons ' +
      'placeholder handling, and Cargo project under src-tauri. Install dependencies, run cargo checks/tests for the Rust ' +
      'side and the frontend build. If the Rust toolchain or platform WebView libraries are missing, state exactly what is ' +
      'missing and still produce the complete project.',
    system: withBuilder(`
You are building a Tauri 2 desktop application in the current empty project folder.

Stack requirements:
- Tauri 2.x (src-tauri/ with Cargo.toml using tauri = "2", tauri-build, and the capability/permission model under src-tauri/capabilities/).
- Frontend: Vite + TypeScript (no React unless you prefer it; vanilla TS keeps the build simple). npm scripts delegate to Tauri via @tauri-apps/cli.
- One custom Rust command registered with generate_handler! that returns a string or structured data, plus a frontend button that calls it via @tauri-apps/api/core invoke.
- Rust edition 2021; include a unit test in Rust for the command logic.

Preferred generation path (non-interactive): write files yourself. If you use the scaffolder, it must be non-interactive, for example:
  npm create tauri-app@latest . -- --template react-ts --manager npm --yes
or the vanilla-ts equivalent, then reconcile with the layout below. Never start an interactive prompt.

Project layout to create:
- package.json (scripts: "dev": "vite", "build": "tsc && vite build", "tauri": "tauri", "test": "cargo test --manifest-path src-tauri/Cargo.toml"), vite.config.ts, tsconfig.json, index.html, .gitignore, README.md.
- src/main.ts: imports @tauri-apps/api/core, wires a button to invoke("greet", { name }) or your command, renders the reply.
- src/styles.css.
- src-tauri/Cargo.toml, src-tauri/build.rs, src-tauri/tauri.conf.json (identifier like com.example.<snake_case_project>, build.distDir = "../dist", devUrl http://127.0.0.1:1420, beforeDevCommand / beforeBuildCommand wired to Vite).
- src-tauri/src/main.rs and src-tauri/src/lib.rs (lib.rs holds the command and run(); main.rs calls the library run per Tauri 2 convention).
- src-tauri/capabilities/default.json granting core:default and any permissions your command needs.
- src-tauri/icons: if the scaffolder or "npx tauri icon" cannot run, create the required icons via the Tauri CLI if available; otherwise document in README that icons must be generated with "npx tauri icon <source>.png" and set a minimal valid PNG if you can write one. Do not leave tauri.conf.json pointing at missing icon files without saying so.

Exact commands:
1. npm install
2. npm run build   (frontend TypeScript + Vite build; must succeed)
3. cargo test --manifest-path src-tauri/Cargo.toml   (or npm test which wraps it; must pass if Rust is installed)
4. cargo check --manifest-path src-tauri/Cargo.toml  (catch compile errors in the Tauri crate; build.rs requires platform WebView deps on Linux: webkit2gtk-4.1, libayatana-appindicator, librsvg; if these are missing, report the apt packages needed)
5. Optional dev smoke: npm run tauri dev (requires a display server; skip headless and note it)

Quality bar:
- No unwrap() in user-facing command code; return Result and map errors to strings.
- No emoji.
- README.md must document: prerequisites (Node 18+, Rust stable via rustup, platform WebView libraries, Linux apt packages), install, dev, build, test, and packaging (npm run tauri build).
`),
  },

  {
    id: 'android-compose',
    name: 'Android Kotlin Jetpack Compose',
    category: 'Mobile',
    description:
      'Native Android app in Kotlin with Jetpack Compose, Gradle Kotlin DSL, and the Gradle wrapper committed.',
    prompt:
      'Scaffold a native Android application named after this folder using Kotlin and Jetpack Compose with the Gradle ' +
      'wrapper included (gradlew, gradlew.bat, gradle/wrapper). Use a single-activity architecture, Material 3, at least ' +
      'two screens or top-level composable destinations, and one ViewModel with a unit test. Generate the Gradle wrapper ' +
      'files so the project builds with ./gradlew without a local Gradle install. Run ./gradlew test and ' +
      './gradlew assembleDebug (or lint) and fix failures. If the Android SDK is missing, still create the full project ' +
      'including the wrapper and report exactly which SDK components are required.',
    system: withBuilder(`
You are building a native Android application in the current empty project folder.

Stack requirements:
- Kotlin 1.9+ or 2.x, Jetpack Compose with the Compose BOM, Material 3, single Activity (MainActivity) as the entry point.
- Gradle Kotlin DSL (build.gradle.kts / settings.gradle.kts) and the Gradle wrapper committed to the repo: gradlew, gradlew.bat, gradle/wrapper/gradle-wrapper.properties, gradle/wrapper/gradle-wrapper.jar.
- Min SDK 26, target/compile SDK 34 (or current stable). Namespace/applicationId derived from the folder name in reverse-DNS form, for example com.example.<slug>.
- MVVM: one ViewModel exposing UiState via StateFlow, one Repository or data class layer kept simple (no network unless asked).
- JUnit for ViewModel unit tests on the JVM (test/ source set), not instrumented tests, so they run without an emulator.

Generating the Gradle wrapper:
- The wrapper (including gradle-wrapper.jar) must exist so the project builds with ./gradlew on a machine without Gradle installed.
- Preferred: if the "gradle" CLI is available, run "gradle wrapper --gradle-version 8.7" (or the version matching your AGP/Compose setup) in the project root.
- If the gradle CLI is unavailable: write gradlew, gradlew.bat, and gradle/wrapper/gradle-wrapper.properties (distributionUrl pointing at the official gradle-8.x-bin.zip) by hand, and copy a gradle-wrapper.jar from any Gradle installation on the machine if one exists. If no wrapper jar can be obtained, state clearly in the final summary that gradle-wrapper.jar must be generated by running "gradle wrapper" once, and still ship the scripts and properties file.

Project layout to create:
- settings.gradle.kts (pluginManagement + dependencyResolutionManagement, repositories mavenCentral and google), build.gradle.kts (root), gradle.properties (android.useAndroidX=true), gradle/libs.versions.toml (version catalog).
- app/build.gradle.kts with android application plugin, kotlin compose plugin, compose true, compose-bom dependency, junit testImplementation.
- app/src/main/AndroidManifest.xml (no unused permissions; application label and exported MainActivity with LAUNCHER intent).
- app/src/main/java/<package path>/MainActivity.kt, ui/theme/ (Theme.kt, Color.kt, Type.kt), ui/HomeScreen.kt, ui/DetailScreen.kt (or a second destination), MainViewModel.kt with UiState, data/SampleRepository.kt.
- app/src/test/java/<package path>/MainViewModelTest.kt asserting state transitions (use kotlinx-coroutines-test if you add it; otherwise test pure logic without launching the dispatcher).
- app/src/main/res/values/strings.xml, themes.xml as needed; adaptive or default launcher icon references must resolve or be replaced with a simple vector/mipmap you create.
- .gitignore, README.md.

Exact commands (use the wrapper; on Windows gradlew.bat, on Linux/macOS ./gradlew):
1. chmod +x gradlew (unix-like systems)
2. ./gradlew testDebugUnitTest   (JVM unit tests; must pass)
3. ./gradlew assembleDebug       (debug APK; must pass)
4. ./gradlew lintDebug           (fix critical lint issues; do not fail the build on pre-existing warnings you cannot fix)

If the Android SDK is missing:
- Create local.properties only if an SDK path is discoverable; never invent one. Document ANDROID_HOME and "sdkmanager" requirements in README.
- You may still run ./gradlew tasks to validate the wrapper if the wrapper jar exists; if the build cannot configure without the SDK, report the missing SDK (platform, build-tools) precisely and continue with static review of Kotlin sources.
- Try to install nothing system-wide; if cmdline-tools exist, you may use sdkmanager to install platform android-34 and build-tools; only do this if it is clearly available.

Quality bar:
- No emoji anywhere in code, resources, or README.
- Composables take state and callbacks as parameters where practical; hoist state out of leaf composables.
- README.md must document: prerequisites (JDK 17, Android SDK, optional Android Studio), wrapper usage, assemble, test, lint, and how to install the APK.
`),
  },

  {
    id: 'expo',
    name: 'React Native Expo',
    category: 'Mobile',
    description:
      'Cross-platform mobile app with React Native, Expo SDK, TypeScript, and expo-router or a simple navigator.',
    prompt:
      'Scaffold a React Native mobile app named after this folder using Expo (managed workflow) and TypeScript. ' +
      'Include at least two screens, a shared theme, and one unit-tested pure function. Install dependencies, verify ' +
      'the TypeScript compiles (npx tsc --noEmit or expo export), and run tests. Fix failures. If native build tools ' +
      'are missing, run the JS-side checks and report what is needed for device builds.',
    system: withBuilder(`
You are building a React Native + Expo mobile application in the current empty project folder.

Stack requirements:
- Expo SDK (latest stable) managed workflow, React Native, TypeScript with strict mode.
- Navigation: expo-router if you generate a project that supports it; otherwise react-navigation native-stack. Do not mix both.
- State: local React state and context; add zustand or redux only if complexity demands it (it will not for this scope).
- Tests: jest with jest-expo preset; test pure logic and reducers, not native rendering, unless the setup is already trivial.

Preferred generation path (non-interactive). Either write files yourself or run one of:
  npx create-expo-app@latest . --template blank-typescript --yes
  npx create-expo-app@latest .          (then remove demo screens)
Never start an interactive prompt. After generation, prune boilerplate screens and replace with the layout below.

Project layout to create:
- package.json (name sanitized to a valid npm name), app.json or app.config.ts (name, slug, orientation, userInterfaceStyle), tsconfig.json, .gitignore, README.md.
- App.tsx (or app/ with expo-router: app/_layout.tsx, app/index.tsx, app/details.tsx).
- src/screens/HomeScreen.tsx and src/screens/DetailsScreen.tsx: navigation between them with a button; pass one parameter through the route or navigation props.
- src/theme.ts: colors, spacing, typography tokens used by both screens.
- src/utils/formatCount.ts (or similar pure function) and src/utils/formatCount.test.ts.

Exact commands (use npm or the package manager the scaffolder chose; keep it consistent):
1. npm install
2. npx tsc --noEmit     (must pass; fix type errors)
3. npm test             ("test": "jest"; must pass; if the scaffolder sets "test": "jest-expo", normalize to "jest" with jest-expo as the preset in package.json jest config)
4. npm run export       (or "npx expo export --platform web" / "npx expo export" to verify the bundle compiles; must succeed for JS bundling)
5. Optional: npx expo-doctor  (fix actionable issues; ignore offline registry failures and report them)

Device builds (do not block on these):
- Android: npx expo run:android requires Android SDK and a device/emulator; iOS requires macOS with Xcode. If absent, skip and list the requirements in the final summary.
- Never commit android/ or ios/ native folders unless you deliberately ran prebuild and intend to keep them; default is managed workflow without those folders.

Quality bar:
- No emoji in UI text or code comments.
- Do not enable expo-updates or any telemetry service.
- README.md must document: prerequisites (Node 18+), install, start (npx expo start), test, typecheck, export, and notes for running on Android/iOS.
`),
  },

  {
    id: 'flutter',
    name: 'Flutter',
    category: 'Mobile',
    description:
      'Cross-platform Flutter app with Material widgets, a feature folder layout, and widget/unit tests.',
    prompt:
      'Scaffold a Flutter application named after this folder using Material 3, with at least two screens and one ' +
      'tested Dart unit. Generate the standard Flutter project structure. Run flutter pub get, flutter analyze, ' +
      'flutter test, and (if an Android toolchain exists) a debug APK build. Fix analyzer and test failures. If the ' +
      'Flutter SDK is missing, state that precisely and still write the complete project.',
    system: withBuilder(`
You are building a Flutter mobile/desktop application in the current empty project folder.

Stack requirements:
- Dart SDK constraints compatible with Flutter 3.x; Material 3 (useTheme from ColorScheme.fromSeed), null safety throughout.
- Structure: lib/main.dart entry, lib/app.dart with MaterialApp, lib/features/<feature>/ with widgets and a controller or simple state class, lib/core/theme.dart for shared theme tokens.
- At least two routes or Navigator pushes between Home and Detail screens.
- Tests: one pure Dart unit test under test/ and one widget test that pumps the home widget and asserts visible text. Prefer flutter_test only; no mockito unless necessary.

Preferred generation path: if the flutter CLI exists, run:
  flutter create --org com.example --project-name <slug> --platforms android,ios .
(replace com.example with a sensible org derived from the folder; use platforms android,ios only). Then replace lib/main.dart and add the layout below. If the flutter CLI does not exist, write pubspec.yaml, analysis_options.yaml, lib/, test/, and the android/ios runner stubs by hand as completely as possible and note that "flutter create ." should be used to regenerate platform runners.

Project layout to create:
- pubspec.yaml (name: slug with underscores, dependencies: flutter, flutter_lints as dev; cupertino_icons optional), analysis_options.yaml (include package:flutter_lints/flutter.yaml), .gitignore, README.md.
- lib/main.dart, lib/app.dart, lib/core/theme.dart, lib/features/home/home_page.dart, lib/features/detail/detail_page.dart, lib/core/format.dart (pure function used by the UI).
- test/format_test.dart (unit), test/home_page_test.dart (widget test: tap or assert a Key text).
- assets/ only if used; reference in pubspec.yaml.

Exact commands:
1. flutter pub get
2. flutter analyze     (must report no issues; fix all findings you introduced)
3. flutter test        (must pass)
4. flutter build apk --debug   (only if ANDROID_HOME / Android toolchain is available; otherwise skip and report requirements)
5. Optional: flutter build web  (if web is enabled and tooling exists; a cheap compile check when Android SDK is missing)

If the Flutter SDK is missing:
- Report the exact install method (for example git clone of the flutter stable channel, or the official tarball) and that "flutter doctor" must be clean for the target platform.
- Still deliver the full lib/, test/, pubspec.yaml, analysis_options.yaml, and README. Do not fabricate command output.

Quality bar:
- No emoji in code or README.
- Use const constructors where possible; avoid deprecated APIs flagged by the analyzer.
- README.md must document: prerequisites, install (flutter pub get), run (flutter run), analyze, test, and build apk/ipa notes.
`),
  },

  {
    id: 'node-api',
    name: 'Node API',
    category: 'Backend',
    description:
      'TypeScript REST API on Express with validation, tests via supertest, and npm scripts for dev, build, and test.',
    prompt:
      'Scaffold a Node.js REST API named after this folder using TypeScript and Express. Include health and CRUD ' +
      'resource endpoints with input validation, structured JSON errors, and in-memory storage. Add supertest-based ' +
      'integration tests. Install dependencies, run the TypeScript build, and run the test suite. Fix failures.',
    system: withBuilder(`
You are building a Node.js REST API in the current empty project folder.

Stack requirements:
- Node 18+ with TypeScript (strict), compiled with tsc to dist/. Express 4 for HTTP.
- Validation with zod (preferred) or a small hand-rolled validator; never trust req.body directly.
- Errors as JSON: { error: { code, message } } with correct status codes (400 validation, 404 not found, 500 unexpected).
- Logging with console or a tiny logger; never log secrets or full request bodies containing credentials.
- Tests: vitest (or node:test) + supertest hitting the Express app exported from src/app.ts without binding a port.
- In-memory repository module so tests can reset state between files; no database.

Project layout to create:
- package.json with scripts: "dev": "tsx watch src/server.ts", "build": "tsc", "start": "node dist/server.js", "test": "vitest run", "typecheck": "tsc --noEmit". Use tsx or ts-node-dev for dev; pin versions.
- tsconfig.json (outDir dist, rootDir src, strict), .env.example (PORT=3000), .gitignore, README.md.
- src/server.ts (reads PORT, starts listen), src/app.ts (export function createApp(): express.Express), src/routes/health.ts, src/routes/items.ts (GET list, GET :id, POST, PATCH :id, DELETE :id), src/middleware/errorHandler.ts, src/middleware/validate.ts, src/items/store.ts (in-memory CRUD), src/items/types.ts (zod schemas or types).
- test/health.test.ts and test/items.test.ts covering happy path, validation failure (400), not found (404), and delete.

Exact commands (use npm):
1. npm install
2. npm run typecheck   (must pass)
3. npm run build       (must produce dist/)
4. npm test            (must pass)
5. Optional smoke: PORT=0 npm start or start on a free port, curl /health, then stop.

Quality bar:
- Bind to 127.0.0.1 by default in development notes; document HOST/PORT env vars.
- No emoji. Never hardcode API keys; .env.example lists names only.
- README.md must document: prerequisites (Node 18+), install, dev, build, start, test, and a short curl example for each endpoint.
`),
  },

  {
    id: 'fastapi',
    name: 'Python FastAPI',
    category: 'Backend',
    description:
      'FastAPI service with Pydantic models, pytest + httpx tests, and a virtualenv-based workflow.',
    prompt:
      'Scaffold a Python FastAPI service named after this folder. Use a src layout, Pydantic v2 models, a health ' +
      'endpoint, and one CRUD router with in-memory storage. Add pytest tests using FastAPI TestClient or httpx. ' +
      'Create a virtualenv, install dependencies, run pytest, and optionally run ruff and mypy. Fix failures.',
    system: withBuilder(`
You are building a Python FastAPI web service in the current empty project folder.

Stack requirements:
- Python 3.11+, FastAPI, Uvicorn (standard extras), Pydantic v2.
- src layout: package name derived from the folder (snake_case), for example src/<pkg>/.
- Dependency management: requirements.txt (pinned major versions) is acceptable; if you prefer modern tooling, pyproject.toml with a [project] table works. Always document the exact install command you used.
- Tests: pytest with fastapi.testclient.TestClient (starlette) or httpx; isolated app factory create_app() so tests do not bind ports.
- In-memory store for the sample resource; no database, no ORM.
- Optional but recommended: ruff for lint/format; add it as a dev dependency and run it.

Project layout to create:
- requirements.txt (fastapi, uvicorn[standard], pydantic; dev: pytest, httpx, ruff) or pyproject.toml equivalents.
- README.md, .gitignore, .env.example (APP_ENV=dev), pytest.ini or [tool.pytest.ini_options] with testpaths = ["tests"].
- src/<pkg>/__init__.py, main.py (create_app() + uvicorn entry __main__ or module factory), api/health.py, api/items.py (router: GET list, GET item_id, POST, PATCH, DELETE), models/item.py (pydantic models: ItemCreate, ItemUpdate, Item), services/store.py (thread-safe in-memory dict), middleware or exception handlers mapping RequestValidationError to a consistent JSON error shape if you customize it.
- tests/conftest.py (fixtures: client via TestClient(create_app())), tests/test_health.py, tests/test_items.py (happy path, 400 on bad payload, 404 on missing id, 204/200 on delete).

Exact commands:
1. python3 -m venv .venv
2. .venv/bin/pip install -r requirements.txt   (on Windows: .venv\\Scripts\\pip)
3. .venv/bin/pytest    (or "python -m pytest" with the venv active; must pass)
4. .venv/bin/ruff check src tests   (if ruff is installed; fix findings you introduced)
5. Optional mypy if you added it; do not add mypy if it would require extensive type: ignore churn.
6. Optional run: .venv/bin/uvicorn <pkg>.main:app --host 127.0.0.1 --port 8000 then curl /health; stop the server afterwards.

Quality bar:
- No emoji. No secrets in code; read optional env vars with pydantic BaseSettings only if needed.
- Keep handlers thin; business logic in services/store.py.
- README.md must document: prerequisites (Python 3.11+), venv creation, install, test, lint, run, and an example curl for each endpoint.
`),
  },
];

module.exports = templates;
