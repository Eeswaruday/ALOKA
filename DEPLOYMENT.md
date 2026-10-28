# ALOKA deployment

## Static frontend

Connect `Eeswaruday/ALOKA` to Vercel, choose `main`, use the repository root, and select the static/Other preset with no build command. PHP files are not executed by Vercel. With `window.ALOKA_API_URL` blank, the student catalogue reads the public `data/experiments.json`, `data/subjects.json`, and `data/categories.json` files bundled in the deployment. Commits to `main` automatically redeploy the connected Vercel project, so published GitHub JSON appears in the next deployment. Set `window.ALOKA_API_URL` to the PHP endpoint only if you want the frontend to read through that host.

## Admin API status

The public catalogue is static and remains available from the JSON files in `data/`. Admin login, private drafts, and publishing need a server API. Vercel's static hosting does not execute the current PHP API. Render Free cannot safely host its current file-backed sessions and drafts because its filesystem is temporary and is cleared on restarts; persistent disks require a paid service. The free route is to move the API to Vercel Functions and store private state in a private Vercel Blob store. That API migration has not been deployed yet.

## Verification

The public static deployment is separate from the admin API. Never put GitHub tokens or password hashes in browser code or Git; backend secrets belong in server-side environment variables.
