# ALOKA admin setup

The public site is static HTML/CSS/JavaScript; admin operations run through `api/admin.php` on a PHP host. Admin authentication uses a separate PHP session, not Clerk. There is no registration route.

## Configure PHP

Use PHP 8.1 or later with cURL, sessions, and HTTPS. Generate the initial password hash with `php api/hash-admin-password.php` on a trusted machine and set it only in the PHP host’s protected environment. Set these variables there:

- `ADMIN_ENABLED=1`
- `ADMIN_EMAIL=admin@example.com`
- `ADMIN_PASSWORD_HASH=<generated password hash>`
- `ADMIN_FORCE_PASSWORD_CHANGE=1`
- `ALOKA_PRIVATE_DIR=<persistent writable path outside the web root>`
- `ALLOWED_FRONTEND_ORIGINS=<exact HTTPS frontend origin>`

The first login must replace the initial password. The updated password hash and drafts are saved in `ALOKA_PRIVATE_DIR`; back it up securely. Keep this directory outside the public document root and persistent across deploys. If a TLS proxy is used, forward `X-Forwarded-Proto: https`.

## Connect GitHub

Create a fine-grained token restricted to this repository with Contents read/write, then set on PHP:

- `GITHUB_TOKEN=<private token>`
- `GITHUB_REPOSITORY_OWNER=Eeswaruday`
- `GITHUB_REPOSITORY_NAME=ALOKA`
- `GITHUB_PRODUCTION_BRANCH=main`

The repository is public, so experiment drafts stay in `ALOKA_PRIVATE_DIR` and are never committed to a GitHub draft branch. Publishing creates a commit on the production branch. Do not enable the editor for arbitrary repository files or send unpublished content to a public branch.

## Current deployment status

The public catalogue works from the static JSON bundled with the Vercel deployment. The current PHP admin API is not deployed on Vercel, so live login, private drafts, and publishing are unavailable. Do not deploy the current file-backed API on Render Free: its filesystem is temporary and its service can sleep when idle.

The no-paid-hosting design is Vercel Functions plus a private Vercel Blob store for admin sessions and drafts. After the API is migrated, connect a private Blob store in the Vercel project's Storage tab and set backend-only environment variables in Vercel. Never expose tokens or password hashes in browser JavaScript, Git, or chat.

Run `php -l api/admin.php`, `php -l api/admin-common.php`, and `php -l api/health.php` before deploying. `api/health.php` returns configuration booleans and never secret values.
