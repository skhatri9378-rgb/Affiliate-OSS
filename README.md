# Affiliate Links

A small, local country-wise affiliate link manager built with the existing React, TypeScript, Vite, Tailwind and SQLite setup. The interface has only **Dashboard**, **Affiliate Links**, and **Manage Countries & Websites**.

Each link belongs to one channel/project, one country, and a separately selected website. Country and website filters combine with AND. Archiving saved options preserves their links; archived options cannot be assigned to new links. Renaming an option keeps its identifier and link associations. Affiliate URLs are stored exactly as entered.

## Start on your Mac

Node.js 24 or newer and npm are required.

```sh
cd <project-folder>
npm ci
npm run dev
```

Open **http://127.0.0.1:1420**. This starts the Node backend and Vite together. Leave that terminal running; press Control-C to stop both.

For the production browser app:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4317**. The production server serves the built React app and local API together. No Vite development server is required in this mode.

For the optional macOS desktop app, install the Xcode Command Line Tools (`xcode-select --install`) and Rust through rustup first. The repository pins Rust 1.90.0. Then run:

```sh
npm run app:dev
npm run app:build
```

The desktop app uses Rust SQLite commands; the browser app uses Node's built-in SQLite backend. Both use the same schema and default database. The packaged desktop app runs without a Node server. The standalone `Affiliate Links.app` appears under `src-tauri/target/release/bundle/macos/`. DMG packaging is omitted because it requires Finder automation permission on this Mac. These builds are not Developer ID signed or notarized.

## Data and backups

On macOS, the default SQLite file is:

```text
~/Library/Application Support/com.affiliateos.desktop/affiliate-os.sqlite
```

Database access stays in the backend. There are no credentials, telemetry, hosted services, or runtime cloud dependencies. Opening saved links contacts their destinations. Optional Link health checks also request tracking URLs after you enable daily checks or choose Check now. Checks are off by default.

Click **Back up data** at the top of the app. The browser downloads a consistent SQLite backup; the desktop shell shows a native Save dialog. The backup includes every saved link, country and promoting website, including archived options. Keep a copy somewhere separate from this Mac when appropriate.

To restore manually: stop the browser server and close the desktop app, make a copy of the current database directory, then replace `affiliate-os.sqlite` with a saved backup. With all app processes stopped, remove any old `affiliate-os.sqlite-wal` and `affiliate-os.sqlite-shm` sidecars before reopening. Never copy only the live database file while the app is running; use **Back up data** instead.

For development and tests only, set `AFFILIATE_OS_DATA_DIR` to a separate directory. The Node backend and desktop debug build honor this override; the release desktop app always uses its macOS application data folder. UI verification used a separate test directory; no examples are seeded in the normal workspace.

## Checks

```sh
npm run check
```

This checks formatting, ESLint, TypeScript and production bundling, runs frontend and Node backend tests, and runs native SQLite tests. Rust 1.90.0 is pinned for reproducible native builds. The tests cover combined filters, CRUD, archive preservation, editing archived associations, exact URL preservation, duplicate names, validation, SQL parameterization, pagination, persistence, backup reopening and HTTP origin checks.

Shortcuts: **⌘ K** focuses link search, **⌘ N** adds a link, **⌘ S** saves the current link form, and **Esc** closes dialogs.

## Project structure

- `src/`: React interface, typed API adapter, Zod validation and UI tests.
- `server/`: local Node HTTP API, SQLite store, shared schema, backend tests.
- `scripts/dev.mjs`: starts and stops the local API and Vite together.
- `src-tauri/`: retained native shell and Rust adapter for the same schema.
- `archive/`: local historical source and installers, excluded from Git. They are not required to build or run the current app.

The manager uses `managed_countries`, `promoting_websites`, and `managed_links`, with foreign keys, indexes and a versioned migration marker. Earlier Affiliate OS tables, if present, are preserved separately; they are not silently transformed into one-country/one-website links.

## Channels and projects

Use the **Channel / Project** selector beneath the app name in the sidebar. Add each individual channel separately (for example, `ABC — Crypto` and `XYZ — Tech`), even if both use YouTube. Selecting an entry shows only its affiliate links and dashboard activity. New links default to the selected entry. Choose **All channels & projects** to see the whole library. Existing saved promoting websites and channels are available in this selector; their links stay attached.

## Daily link health

Open **Link health** in the top bar, then choose **Enable daily checks**. Checks run every 24 hours while the local Node server is running, and overdue links are checked after it restarts. The Mac must be awake and online for a check to finish. The native desktop app can display saved results; starting checks and scheduling is handled by the local browser/Node app. Closing a browser tab does not stop an independently running Node server.

**Check now** checks active links for the selected channel/project, or all active links when All workspaces is selected. Archived countries and channels are skipped. Daily checking covers every active channel/project. Each URL receives a HEAD request, with bounded redirects and timeouts, no cookies or login, and no fallback page download. Private and reserved network addresses are not requested.

Results under each URL are **Working** (HTTP 2xx), **Likely broken** (404/410), or **Needs review** (including blocked HEAD requests, login requirements, rate limits, timeouts and network errors). A working response does not verify referral attribution, commission eligibility, or the offer's content. Hover over the badge for the timestamp and details. Editing a URL clears its old result; URLs are never replaced automatically. Health results and the daily-check preference are included in database backups. Requests to tracking URLs may register tracking activity.

## Websites are separate from channels/projects

The sidebar chooses the channel/project (for example, income365). In **Add Link**, that selection is shown separately above **Country** and **Website**. Use **Add website** to save a website without creating or changing a project. Website names can be reused across projects, and website and country filters combine with the selected project.

The website-separation migration preserves the original channel/project identifier on every existing link and leaves the new website unassigned. Edit an existing link and choose its website. A timestamped `before-websites` SQLite backup is created beside the database before adding the website association. No links, tracking URLs, notes, or timestamps are deleted or rewritten by this migration.

## GitHub and local files

Commit the source, configuration, `package-lock.json`, and `src-tauri/Cargo.lock`. Dependencies, generated builds, local SQLite databases and sidecars, backups, historical archives, environment files, signing keys, and local credentials are excluded by `.gitignore`.

No API keys or environment file are needed to run the app. If adding integrations later, keep real credentials in ignored local environment files; commit only placeholder values in `.env.example`. Never put secrets into frontend source or `VITE_` variables, which are exposed in browser bundles. `.gitignore` does not remove files already tracked by Git or erase repository history.

The default user database lives outside the repository in the application data directory described above. Do not copy live affiliate data or database backups into source files before publishing.

## Electron desktop app

Install dependencies with `npm ci`, then run `npm run electron:dev`. Build the macOS app with `npm run electron:build`; the application is written to `electron-release/`. Electron includes its runtime and starts the local backend automatically, with no separate Node server required.

On macOS it uses the same existing `com.affiliateos.desktop/affiliate-os.sqlite` application data location. Closing all windows keeps the app and daily link checks running until you quit it with Command-Q. Saved external links open in the default browser. Database backups download through the desktop window. The renderer is sandboxed with Node integration disabled. The browser and Tauri launch commands remain available.

For an isolated startup test: `AFFILIATE_OS_DATA_DIR=/tmp/affiliate-electron-test npm run electron:smoke` after building. Never use your normal data folder for this test. Builds are unsigned and not notarized.
