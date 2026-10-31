# FrameRelay

A single-server photobooth workflow: registration → photography → selection/editing → manual printing and private digital delivery. One deployment serves a single shared workflow with editable settings.

## Local development

Requires Node.js 24+ and npm.

```powershell
npm install
npm run dev
```

Open [FrameRelay](http://127.0.0.1:5173). The first run creates a gitignored `.env` containing a randomly generated `SETUP_PASSCODE`. Open that file locally, then visit **Setup**, unlock it with that passcode, and set the shared staff passcode. The event name is optional; no organization or photobooth details are collected. There are no default credentials or seeded events.

For full-resolution server export, install Chromium using the same cache location as `.env`:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = './node_modules/.cache/ms-playwright'
npx playwright install chromium
```

On macOS/Linux, use `PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/ms-playwright npx playwright install chromium`.

Development binds to localhost. Other devices require an HTTPS deployment: camera access and Chrome directory selection depend on a secure context. Keep the photography tab visible and the Mac awake while watching a folder.

## Stations

Every staff station has a persistent header, a viewport-sized workspace, and a one-line footer (custom text, local clock with seconds, server connectivity, current status, local settings). Customer stations show the current ticket and Back/Next/Finish actions in the header. The Print Station shows its station name without a customer ticket or Finish customer action.

Switch station roles using **Station settings** in the bottom-right corner. The header station name is a label.

- **Registration** generates tickets after payment is collected separately. Next customer creates the next QR; the previous QR can be redisplayed.
- **Photography** scans or looks up a ticket, accepts JPEG uploads, and optionally polls a Chrome-selected export folder. Uploading photos appear immediately as 3:2 cropped previews, with progress/retry directly below each image. Finish exporting before Finish customer; the station checks the folder and drains uploads before switching.
- **Select & Edit** uses a scrolling image grid, modal preview, two-image comparison and a full-workspace Image Ultra editor with native Adjust, Finetune, Filter and Sticker tabs. Crops are restricted to 3:2 or 2:3. Finals are reviewed before publishing. The handoff prioritizes collecting prints later, with an optional smaller digital download QR; it announces prints ready only after they are marked printed.
- **Printing** groups jobs by ticket. Download JPEG, submit to PaperCut, release printing, then Mark printed. Downloading alone never completes a print. Undo and reprint are explicit.

Image filenames follow `T0001_01_20261031T062608123Z.jpg`: globally unique ticket, stable source image number within the ticket, UTC upload/version timestamp. Original camera names remain metadata. Exclusions never renumber images or delete originals.

Grid thumbnails fill a 3:2 frame without letterboxing; this display crop never changes the original image. Full-image inspection supports scroll/pinch zoom, panning and a thumbnail navigator. Photography offers highlight zebras, enabled by default, without changing the image. Photography and Select & Edit show every capture in one scrolling images area while their controls, header and footer stay fixed. Excluded selection photos stay in place, darkened with one diagonal strike-through, and can be restored. Long queues, settings and unusually tall content use contained scrolling. Local settings are scoped by the current workflow, station and browser; their footer override does not change the event default.

## Setup and clearing data

The operator can set an optional display name, staff passcode, delivery settings, colors and default footer text. Settings can be changed at any time and apply to the current workflow. Changing the staff passcode signs staff out.

When work is complete, an operator can choose **Clear all data** in Setup and type `CLEAR` to confirm. This deletes all server-side tickets, photos, print queues and download links, including historical records from previous versions. Settings and the staff passcode are retained; staff must sign in again. Wait for uploads and exports to finish, and back up anything needed before clearing. Browser-local drafts or uploads on other devices and separate backups are not erased by the server reset.

Existing active event settings continue to work after upgrading. Historical downloads remain available until data is cleared; they keep their historical settings. If no event was active, set up the stations before use.

Inter is bundled and served locally through Fontsource, including the photo editor. The editor, QR scanner and all application assets run locally; no CDN, analytics, email, external storage or payment integration is required.

## Storage and recovery

`DATA_DIR` (default `./data`) contains SQLite, originals, previews, thumbnails, edited finals and branding images. Keep this directory private and persistent. Images are served through authorized APIs, never through a public static-files directory. Customer identification QR tokens cannot download originals or finals; delivery tokens expose only that customer's chosen finals.

Ticket creation and submission are idempotent. Original uploads deduplicate by content within the ticket. Interrupted browser uploads are retained in IndexedDB when available and can be retried. Selection uses a renewable 90-second station claim; a crashed station releases its claim through expiry. Draft edit recipes are saved locally and on the server.

Image Ultra performs editing/export in the browser. If it reports downscaling or export fails, the same renderer runs in server-side Chromium, one export at a time. SQLite retains pending jobs across restarts. Full-resolution output is required: the server never accepts a downscaled fallback as a successful server export. Original JPEGs remain unchanged; final exports omit EXIF/GPS metadata.

Folder polling cannot identify which customer owns an export that appears late. Staff must finish exports before switching customers. A new customer establishes a baseline and detects subsequent additions. Manual uploads remain available when folder permission expires or the browser does not support the API.

## VPS deployment

Install Docker/Compose on a Linux VPS, point a hostname to it, and open ports 80/443. Set these values in the deployment `.env`:

```dotenv
DOMAIN=photos.example.org
SETUP_PASSCODE=replace-with-a-long-random-operator-passcode
```

```sh
docker compose up -d --build
```

Caddy provides HTTPS. The application uses secure, HTTP-only cookies in production. Only Caddy exposes public ports; the application and SQLite remain behind it. Chromium and its Linux dependencies are installed by the Dockerfile.

For a manual production start, set `NODE_ENV=production`, `PUBLIC_ORIGIN=https://your-hostname`, `HOST`, `PORT`, `SETUP_PASSCODE`, `DATA_DIR` and a writable `PLAYWRIGHT_BROWSERS_PATH`, run `npm run build`, and use `npm start` behind an HTTPS reverse proxy.

Keep one application instance against the SQLite volume. Size storage from expected JPEG sizes × captures/customer × customers, allowing room for previews, finals and backups. Validate memory usage with actual camera files before the event.

## Backup and shutdown

Stop ingestion/editing, briefly stop the app, then copy the **entire data directory/volume**, including SQLite and every image directory, to a protected backup. Restart the app after the copy. Restore the full directory into the same layout while the app is stopped; the database and files belong together. Test a restored copy before event day.

Do not decommission hosting while downloads are promised. Disable downloads deliberately, communicate availability externally, then stop the app and handle stored images/backups according to the organizer's retention policy. There is no in-app bulk deletion tool.

## Verification

```sh
npm run build
npm test
npm run test:e2e
```

Run the build before browser tests. Playwright uses a separate temporary database/server on port 3401 and does not seed your development event. Screenshots/traces are stored outside the repository. `QA_ARTIFACT_DIR` can override the screenshot destination; `QA_PHOTO_PATH` can supply a local sample photo for visual QA.

Backend tests cover authorization, settings and reset behavior, upload deduplication, exclusions, concurrent selection claims, publication, print status, restart recovery and old-event branding. Browser tests cover all stations, local preferences, responsive layouts and five 24 MP exports including the server fallback.

Before event use, test QR scans from photographed phone screens, actual school iPads/Safari, the real Lightroom export folder, school Wi-Fi upload performance and manual PaperCut release. Chromium viewport emulation cannot establish physical-device compatibility.
