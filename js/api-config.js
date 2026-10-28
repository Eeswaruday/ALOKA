// Local PHP development uses /api/admin.php; Vercel uses its serverless API.
window.ALOKA_API_URL = ['localhost', '127.0.0.1'].includes(location.hostname) ? '' : '/api/admin';
