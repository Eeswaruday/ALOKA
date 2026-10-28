# ALOKA deployment

## Static frontend

Connect `Eeswaruday/ALOKA` to Vercel, choose `main`, use the repository root, and select the static/Other preset with no build command. PHP files are not executed by Vercel. With `window.ALOKA_API_URL` blank, the student catalogue reads the public `data/experiments.json`, `data/subjects.json`, and `data/categories.json` files bundled in the deployment. Commits to `main` automatically redeploy the connected Vercel project, so published GitHub JSON appears in the next deployment. Set `window.ALOKA_API_URL` to the PHP endpoint only if you want the frontend to read through that host.

## PHP backend

The repository includes a Render Blueprint (`render.yaml`) for the PHP API. In Render, create a Blueprint from `Eeswaruday/ALOKA` on `main`, then enter the requested values from your local `.env` in Render's protected environment-variable form. `ADMIN_PASSWORD_HASH` must be a PHP password hash, not a plain-text password. Do not put secrets in Git, this chat, or Vercel. The service uses a persistent disk for sessions, password state, and private drafts; choose a Render plan that supports persistent disks.

The Vercel frontend uses the same-origin `/api/` route, which proxies to `aloka-admin-api-eeswaruday.onrender.com`; keep the Render service name aligned with that hostname. The Blueprint allows only `https://aloka-share.vercel.app` as a browser origin. It configures GitHub access for `Eeswaruday/ALOKA` on `main`; the GitHub token is entered only as a protected Render environment variable. Drafts stay on the private disk. Publishing commits the experiment JSON to `main`, which triggers the connected Vercel redeployment. Clerk's browser publishable key is separate; Clerk server keys and Resend are not used by the current admin API.

## Verification

After Render reports the service healthy, open `/api/health.php` on its `onrender.com` hostname and confirm the integration flags are enabled without exposing credentials. Then verify login, draft save, publish, GitHub commit, and Vercel redeployment. Never deploy GitHub tokens or admin password hashes in browser code, Vercel, or Git.
