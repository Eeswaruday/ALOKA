# ALOKA — Intelligence beyond limits

ALOKA is a static, local-first lab preparation site built with HTML, CSS, and vanilla JavaScript. It includes a responsive learning workspace, experiment library, search, viva practice, device-local bookmarks and revision checks, and an offline cache on HTTPS or localhost. Regular-user sign-in uses Clerk. Administrator access is a separate PHP session and GitHub draft workflow; it does not use Clerk or an application database.

## Preview

Open `index.html` directly for the landing page. Browsers restrict `fetch()` from `file://`, so the JSON-backed library needs localhost. With PHP installed, run `php -S localhost:8000` in this folder and visit `http://localhost:8000`. Bookmarks and revision checks stay in that browser's local storage; they are not shared or synced.

## Integrations

- Clerk's vanilla JavaScript SDK powers regular user sign-in. The app is linked to the ALOKA development instance; provider availability depends on its Clerk Dashboard settings. Production Clerk has not been configured.
- The admin login UI and PHP API are implemented under `admin/` and `api/`. Admin access stays disabled until the PHP host has its environment configured. GitHub file changes are staged on a draft branch and merge to production only after explicit confirmation.
- Follow [ADMIN_SETUP.md](ADMIN_SETUP.md) to configure the initial admin hash, private persistent storage, GitHub token, CORS origin, and deployment. Never put the admin hash or GitHub token in Vercel or frontend code.
- `api/health.php` reports configuration booleans only. `.vercelignore` excludes PHP endpoints from the static Vercel deployment.
- Resend is not used in the current login or password-change flow.

## Deployment

Deploy the project root to Vercel as a static site. There is no build or install command. Deploy the `api/` PHP endpoints separately to a PHP-compatible host with HTTPS, cURL, and sessions. Set the full PHP endpoint URL in `admin/admin-config.js` and allow the exact frontend origin on PHP.

## PHP

The local PHP CLI includes cURL and OpenSSL. Verify with `php -v` and `php -m`. Do not deploy secrets in public files or commit local environment files.

## Content

Edit `data/experiments.json` and `data/viva.json`. Keep these public files free of secrets. Local progress uses `aloka.*` keys in browser storage.
