# ALOKA deployment checklist

## Frontend on Vercel

Connect `Eeswaruday/ALOKA` and select `main` as the production branch. Use the repository root as the project root. This is a static HTML/CSS/JavaScript site: leave the framework preset as Other, leave the build command empty, and use the root directory as the output. `index.html` is the entry page; the admin routes are rewritten in `vercel.json`. The `api/` folder is intentionally excluded because Vercel static hosting does not execute these PHP endpoints.

The project currently has no Vercel project link or deployment URL configured in this checkout. After importing it, verify the deployment URL and add it to `ALLOWED_FRONTEND_ORIGINS` on the PHP host. Do not add PHP credentials to Vercel.

Clerk's publishable key is public frontend configuration and is currently read from `js/clerk-config.js`; static Vercel environment variables do not automatically populate that JavaScript file. `CLERK_SECRET_KEY` belongs only on a server that actually implements Clerk server-side operations. The current public site uses Clerk's browser SDK; the admin API has its own session authentication.

## PHP backend

Deploy `api/admin.php`, `api/admin-common.php`, and `api/health.php` to a PHP 8.1+ host with cURL and sessions enabled, HTTPS, and persistent writable storage outside the web root. `api/hash-admin-password.php` is a CLI-only setup helper. PHP source being present in GitHub does not mean the API is deployed.

After obtaining the HTTPS API URL, set it in `admin/admin-config.js` as the full URL to `admin.php`. The admin UI refuses to send requests on non-local sites until that URL is configured. Keep `ALLOWED_FRONTEND_ORIGINS` restricted to the exact production frontend origin. Configure `X-Forwarded-Proto: https` if the PHP host sits behind a TLS proxy.

Set backend values in the PHP host's protected environment settings:

- `ADMIN_ENABLED`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_FORCE_PASSWORD_CHANGE`, and `ALOKA_PRIVATE_DIR` for administrator login and persistent session state.
- `ALLOWED_FRONTEND_ORIGINS` for exact-origin CORS.
- `GITHUB_TOKEN`, `GITHUB_REPOSITORY_OWNER`, `GITHUB_REPOSITORY_NAME`, `GITHUB_PRODUCTION_BRANCH`, and `GITHUB_DRAFT_BRANCH` for repository operations. Restrict the fine-grained token to this repository and Contents read/write.
- `CLERK_SECRET_KEY` only if a server-side Clerk integration is added. The current Clerk usage is browser-side and does not use it.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` only if email delivery is implemented. No Resend sending flow currently exists; `CLERK_AUTHORIZED_ADMIN_IDS` is also not currently consumed by the app.

The local `.env` file is ignored by Git and is not automatically loaded by PHP. `.env.example` contains placeholders only. Never copy secret values into frontend JavaScript, Vercel, or Git.

## Checks and go-live

Before publishing, run the repository syntax and asset checks. Then verify the Vercel deployment and the PHP health endpoint independently. Confirm admin login, GitHub draft creation, file editing, and publish behavior on the PHP host before enabling production admin access. Keep the PHP private data directory backed up and outside the document root.
