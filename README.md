# FrameRelay

FrameRelay is a self-hosted photobooth workflow for registration, photography, photo selection and editing, printing, and private digital delivery. One deployment serves one shared workflow, with settings managed by an operator.

## How it works

1. **Registration** creates a ticket and identification QR code for each customer.
2. **Photography** looks up the ticket, uploads JPEGs, and can watch a supported browser-selected export folder.
3. **Select & Edit** lets staff review captures, choose finals, and edit them with Image Ultra. Customers can receive a private download QR code.
4. **Printing** groups submitted finals by ticket. Staff download each image and print it using their existing print system, then mark it printed.

Each station can run on a separate device. Use **Station settings** to switch roles or adjust browser-local preferences. FrameRelay does not collect payments or send email.

## Run locally

Requirements: Node.js 24 or later and npm.

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). On a fresh installation, the terminal prints a randomly generated operator passcode once; save it. Open **Setup**, unlock it with that passcode, choose a staff passcode and save the settings. The first run also creates a local, gitignored `.env` with development settings.

The development server listens on localhost. Use an HTTPS deployment for other devices: camera access and browser folder selection require a secure context. Folder watching depends on browser support and permission; manual JPEG upload is also available.

The photo editor normally exports in the browser. For the full-resolution server fallback, install Chromium at the configured browser path:

```sh
PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/ms-playwright npx playwright install chromium
```

On PowerShell, set `$env:PLAYWRIGHT_BROWSERS_PATH = './node_modules/.cache/ms-playwright'` before running `npx playwright install chromium`.

## Install on a device

Over HTTPS, use the browser's install option, or **Share → Add to Home Screen** on iPhone or iPad. Each device remembers its last station role and opens it on the next app launch; a new device starts at Registration.

The installed app can load its shell offline and displays a reconnecting screen when the server is unavailable. Station operations require the server. The service worker does not cache API responses, customer records, or photo responses.

## Operator settings and reset

In **Setup**, an operator can change the optional display name, staff passcode, delivery options, print dimensions and copies, colors, and default footer text. At least one delivery method must be enabled. Changing the staff passcode signs staff out. Under **Admin access**, an operator can change the operator passcode after providing the current one; this signs out all operator sessions. Operator passcodes are stored as salted scrypt hashes.

When a session is finished, **Clear all data** permanently deletes server-side tickets, photos, print queues, and customer download links, including records from older versions. Confirm by typing `CLEAR`. Settings and the staff passcode remain; staff must sign in again. Finish uploads and exports and back up anything needed first. The action does not erase separate backups or browser-local drafts and uploads on other devices.

Existing active event settings remain usable after upgrading from an older release. Historical downloads remain available until data is cleared, subject to their existing download settings.

### Reset a forgotten operator passcode

On a server with shell access, run the recovery script as the application user, using its data directory. For example, with the systemd layout `/opt/framerelay/current` and `/var/lib/framerelay`:

```bash
cd /opt/framerelay/current
read -rs -p 'New operator passcode (12–128 characters): ' FRAMERELAY_NEW_PASSCODE; echo
printf '%s' "$FRAMERELAY_NEW_PASSCODE" | sudo -u framerelay env DATA_DIR=/var/lib/framerelay /usr/bin/node --import tsx scripts/reset-operator.ts
unset FRAMERELAY_NEW_PASSCODE
```

For the Compose deployment below, use `docker compose exec -T app node --import tsx scripts/reset-operator.ts` as the receiving command instead. The script reads from standard input, updates the hash and signs out operator sessions. It does not delete customer data or require a restart.

`SETUP_PASSCODE` is a bootstrap value used only when no operator hash exists. For an existing installation, changing that environment variable does not reset the passcode. Remove any legacy plaintext `SETUP_PASSCODE` from the environment file after a successful migration.

## Deploy with Docker Compose

Install Docker and Compose on a Linux server, point a hostname at it, and make ports 80 and 443 reachable. Set the hostname in the deployment `.env`:

```dotenv
DOMAIN=photos.example.org
```

For a fresh data volume, choose an initial operator passcode in a Bash shell and start the stack:

```bash
read -rs -p 'Initial operator passcode (12–128 characters): ' FRAMERELAY_INITIAL_PASSCODE; echo
export SETUP_PASSCODE="$FRAMERELAY_INITIAL_PASSCODE"
docker compose up -d --build
unset SETUP_PASSCODE FRAMERELAY_INITIAL_PASSCODE
docker compose up -d
```

The second `up` recreates the app without retaining the bootstrap passcode in its container environment. Save the passcode securely; the server stores only its hash. Caddy provides HTTPS, and only Caddy exposes public ports. The app, SQLite database, and images use the persistent `photos` volume. The Docker image installs Chromium and its system dependencies for server-side exports.

For a manual deployment, build with `npm run build` and run `npm start` behind an HTTPS reverse proxy. Configure `NODE_ENV=production`, `PUBLIC_ORIGIN`, `HOST`, `PORT`, `DATA_DIR`, and a writable `PLAYWRIGHT_BROWSERS_PATH`. Supply `SETUP_PASSCODE` only for the first start of a fresh database, then remove it from the service environment.

Run one application instance against each SQLite volume. Size persistent storage for original captures, previews, final images, and backups. Test memory use with real camera files before an event.

## Data, recovery, and operational notes

`DATA_DIR` (default `./data`) contains SQLite, originals, previews, thumbnails, edited finals, and other assets. Keep it private and persistent. Customer identification QR tokens cannot download photos; delivery tokens expose only that customer's selected finals.

Stop ingestion and editing, briefly stop the app, and back up the **entire data directory or volume**, including the database and all image directories. Restore the complete backup while the app is stopped and test it before use. Clearing application data does not clear your backups.

Original uploads are deduplicated by content within a ticket. Interrupted browser uploads can be retried when retained in IndexedDB. Selection uses a renewable 90-second station claim; a claim expires if a station stops responding. Edit recipes are saved locally and on the server.

Images display after loading and decoding. Short connection interruptions leave the current screen in place; after five seconds of an observed outage, a reconnecting screen covers it until service returns. Read requests can resume after reconnection. An interrupted write is not automatically replayed because the server may already have received it.

Full-resolution exports run in the browser, with a server-side Chromium fallback processed one at a time. Originals are unchanged and final exports omit EXIF/GPS metadata. Finish all exports before switching customers: folder polling cannot determine which customer owns a late-arriving file.

## Development and verification

```sh
npm run build
npm test
PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/ms-playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/ms-playwright npm run test:e2e
```

On PowerShell, set `$env:PLAYWRIGHT_BROWSERS_PATH = './node_modules/.cache/ms-playwright'` before the Playwright commands instead. Build before running browser tests. Playwright starts an isolated temporary database and server on port 3401. Screenshots and traces are written outside the repository; `QA_ARTIFACT_DIR` changes the screenshot directory and `QA_PHOTO_PATH` supplies a sample photo.

Test the real deployment with the devices, browser, cameras, export folder, Wi-Fi network, QR screens, and print process you plan to use. Chromium viewport emulation does not establish compatibility with physical iPads or Safari.

## Licensing

FrameRelay is licensed under the [MIT License](LICENSE). Third-party components have their own licenses; existing notices for Inter and Image Ultra are in [`public/licenses`](public/licenses). Review and retain the applicable third-party notices, including those for bundled and native dependencies, when distributing a build or image.
