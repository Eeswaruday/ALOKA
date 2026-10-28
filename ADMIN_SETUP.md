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

## Deploy with Vercel and Render

Create a Render Blueprint for this repository from `render.yaml`. Enter `ADMIN_ENABLED=1`, the admin email, the password hash, and the fine-grained GitHub token in Render's protected environment settings. The hash must be generated with `php api/hash-admin-password.php`; never enter a plain-text password as `ADMIN_PASSWORD_HASH`. The Blueprint mounts persistent storage at `/var/data/aloka` for sessions, password state, and drafts. A Render plan with persistent-disk support is required.

The frontend's `/api/` requests are proxied by Vercel to `aloka-admin-api-eeswaruday.onrender.com`, configured in `vercel.json`. Keep the Render service name unchanged so its hostname matches. If Render reports that name is unavailable, update the hostname in `vercel.json` to the hostname Render assigns, then redeploy Vercel. The current allowed browser origin is `https://aloka-share.vercel.app`.

Run `php -l api/admin.php`, `php -l api/admin-common.php`, and `php -l api/health.php` before deploying. `api/health.php` returns configuration booleans and never secret values.
