# ALOKA deployment

## Static frontend

Connect `Eeswaruday/ALOKA` to Vercel, choose `main`, use the repository root, and select the static/Other preset with no build command. PHP files are not executed by Vercel. With `window.ALOKA_API_URL` blank, the student catalogue reads the public `data/experiments.json`, `data/subjects.json`, and `data/categories.json` files bundled in the deployment. Commits to `main` automatically redeploy the connected Vercel project, so published GitHub JSON appears in the next deployment. Set `window.ALOKA_API_URL` to the PHP endpoint only if you want the frontend to read through that host.

## PHP backend

Deploy `api/admin.php`, `api/admin-common.php`, and `api/health.php` to PHP 8.1+ with cURL, sessions, HTTPS, and a persistent writable directory outside the web root. Set `ADMIN_ENABLED`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_FORCE_PASSWORD_CHANGE`, and `ALOKA_PRIVATE_DIR` in the PHP host’s protected environment. Configure `ALLOWED_FRONTEND_ORIGINS` to the exact Vercel origin.

Configure GitHub access on PHP with `GITHUB_TOKEN`, `GITHUB_REPOSITORY_OWNER`, `GITHUB_REPOSITORY_NAME`, and `GITHUB_PRODUCTION_BRANCH`. Keep the token only in the PHP host’s protected environment (or ignored local configuration), never in browser JavaScript or Vercel frontend variables. The repository is public; drafts are therefore stored only in private PHP storage. Publishing commits approved experiments to the production branch, which triggers Vercel redeployment. Clerk’s browser publishable key remains separate from these backend credentials; Clerk server keys and Resend are not used by the current admin API.

## Verification

Run `php -l` on `api/admin.php`, `api/admin-common.php`, and `api/health.php`; run `node --check` on `js/app.js` and `admin/admin.js`; parse all `data/*.json`. Then verify `api/health.php`, an unauthenticated `action=content` rejection, the public experiment endpoint, and a full admin save/publish flow on the actual PHP host. Never deploy GitHub tokens or admin password hashes in browser code, Vercel, or Git.
