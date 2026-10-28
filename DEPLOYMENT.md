# ALOKA deployment

## Vercel deployment

Connect `Eeswaruday/ALOKA` to Vercel, deploy the `main` branch from the repository root, and use the static/Other preset with no build command. `api/admin.js` runs as a Vercel Node Function; the PHP files are for local PHP development only. Add the variables below under Vercel Project → Settings → Environment Variables for Production and Preview, then redeploy:

```text
ADMIN_ENABLED=1
ADMIN_EMAIL=your-admin-email
ADMIN_PASSWORD=choose-a-strong-password
GITHUB_TOKEN=<fine-grained token with Contents read/write for Eeswaruday/ALOKA>
GITHUB_REPOSITORY_OWNER=Eeswaruday
GITHUB_REPOSITORY_NAME=ALOKA
GITHUB_PRODUCTION_BRANCH=main
GITHUB_DRAFT_BRANCH=aloka-drafts
```

Keep these values in Vercel server-side environment variables only; do not place them in `js/api-config.js` or commit them. The browser calls `/api/admin`; the public catalogue is served from the deployed JSON. Saving a draft commits `data/admin-drafts.json` to `aloka-drafts`. Publishing commits `data/experiments.json` to `main`, which starts Vercel’s automatic deployment when the GitHub integration is connected.

## Verification

This uses Vercel’s included function allowance and GitHub Contents API; no database or paid storage is required. The GitHub repository must grant the token Contents read/write access. Because `aloka-drafts` is a branch of the repository, its draft JSON is visible to anyone who can view the repository. Use this only if that is acceptable for experiment drafts.
