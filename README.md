# ALOKA — Intelligence beyond limits

ALOKA is a responsive lab-experiment learning site built with HTML, CSS, vanilla JavaScript, and a PHP admin API. Students browse published experiments, search by title or language, open source code, and keep bookmarks in their browser. Admins add experiments using only a title, programming language, and source code, then save drafts or publish them.

## Local preview

Run `php -S localhost:8000` from the repository root and open `http://localhost:8000`. The student catalogue reads published entries from the PHP API when configured, or from the committed `data/*.json` files on a static host such as Vercel. The admin interface requires the PHP host to be configured first. The local PHP development server reads the ignored `.env` file; set `ADMIN_PASSWORD` there for the initial login. Never commit `.env` or `api/config.php`.

## Admin and content

Admin authentication is a separate secure PHP session from Clerk. Experiment drafts are stored in persistent private PHP-host storage. Publishing writes only the experiment catalogue JSON to the configured GitHub production branch; deletions are GitHub commits and can be restored from repository history. Subjects and categories are also stored on GitHub. Follow [ADMIN_SETUP.md](ADMIN_SETUP.md) to configure credentials, private storage, GitHub access, CORS, and the frontend API URL.

The repository is public, so drafts are kept off GitHub to prevent unpublished work from becoming public through a branch. To keep drafts in a Git remote, the repository must first be made private and the storage design reviewed.

## Deployment

The frontend is static and can be deployed to Vercel from the repository root. GitHub commits to the production branch trigger Vercel redeployment; the frontend then reads the published `data/*.json` files from that deployment. PHP endpoints in `api/` require a separate PHP 8.1+ host with cURL, sessions, HTTPS, and persistent private storage. The PHP host keeps the GitHub token private and writes published experiments to GitHub. Set `window.ALOKA_API_URL` in `js/api-config.js` only when the PHP API should serve the public catalogue directly. See [DEPLOYMENT.md](DEPLOYMENT.md).

Clerk remains the optional browser-side sign-in for regular users. Resend is not used in the current login or password-change flows. `api/health.php` reports integration booleans only.
