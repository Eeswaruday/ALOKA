<?php
declare(strict_types=1);

// Local-only config.php is gitignored; production credentials come from the PHP host environment.
$localAdminConfig = __DIR__ . '/config.php';
if (is_file($localAdminConfig)) require_once $localAdminConfig;

final class AdminApiError extends RuntimeException
{
    public function __construct(public readonly int $httpStatus, string $message)
    {
        parent::__construct($message);
    }
}

function admin_env(string $name, string $default = ''): string
{
    $value = getenv($name);
    return $value === false ? $default : trim($value);
}

function admin_private_dir(): string
{
    $directory = admin_env('ALOKA_PRIVATE_DIR');
    if ($directory === '') $directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aloka-admin';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new AdminApiError(503, 'Private admin storage is unavailable.');
    }
    @chmod($directory, 0700);
    $directory = realpath($directory) ?: $directory;
    $documentRoot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($documentRoot !== false && $documentRoot !== '') {
        $prefix = rtrim($documentRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if (strcasecmp($directory, rtrim($documentRoot, DIRECTORY_SEPARATOR)) === 0 || strncasecmp($directory, $prefix, strlen($prefix)) === 0) {
            throw new AdminApiError(503, 'Private admin storage must be outside the document root.');
        }
    }
    return rtrim($directory, DIRECTORY_SEPARATOR);
}

function admin_json(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function admin_read_json(): array
{
    $data = json_decode(file_get_contents('php://input', false, null, 0, 2_100_000) ?: '', true);
    if (!is_array($data)) {
        throw new AdminApiError(400, 'Request body must be valid JSON.');
    }
    return $data;
}

function admin_cors_and_session(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Frame-Options: DENY');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $allowed = array_filter(array_map('trim', explode(',', admin_env('ALLOWED_FRONTEND_ORIGINS'))));
        $requestOrigin = (admin_is_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? '');
        if ($origin !== $requestOrigin && !in_array($origin, $allowed, true)) {
            throw new AdminApiError(403, 'This origin is not allowed.');
        }
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    $secure = admin_is_https();
    if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== parse_url('//' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST) && !$secure) {
        throw new AdminApiError(503, 'HTTPS is required for cross-origin admin sessions.');
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    session_name('aloka_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => $origin !== '' && parse_url($origin, PHP_URL_HOST) !== parse_url('//' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST) ? 'None' : 'Strict',
    ]);
    if (!session_start()) {
        throw new AdminApiError(503, 'Could not start a secure admin session.');
    }
    $now = time();
    if (isset($_SESSION['admin_last_seen']) && ($now - (int) $_SESSION['admin_last_seen'] > 1800 || $now - (int) ($_SESSION['admin_created_at'] ?? $now) > 43200)) {
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['admin_expired'] = true;
    }
    $_SESSION['admin_last_seen'] = $now;
}

function admin_is_https(): bool
{
    return (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function admin_require_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $stored = $_SESSION['admin_csrf'] ?? '';
    if ($sent === '' || $stored === '' || !hash_equals($stored, $sent)) {
        throw new AdminApiError(403, 'Session check failed. Refresh and try again.');
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        throw new AdminApiError(403, 'Request origin could not be verified.');
    }
}

function admin_require_auth(bool $allowPasswordChange = false): void
{
    if (empty($_SESSION['admin_email'])) {
        throw new AdminApiError(401, 'Sign in again to continue.');
    }
    if (!empty($_SESSION['admin_must_change']) && !$allowPasswordChange) {
        throw new AdminApiError(403, 'Change the initial password before continuing.');
    }
}

function admin_credentials(): array
{
    if (admin_env('ADMIN_ENABLED') !== '1') {
        throw new AdminApiError(503, 'Admin access is disabled on this server.');
    }
    $email = strtolower(admin_env('ADMIN_EMAIL'));
    $initialHash = admin_env('ADMIN_PASSWORD_HASH');
    if ($email === '' || $initialHash === '' || !password_get_info($initialHash)['algo']) {
        throw new AdminApiError(503, 'Admin credentials are not configured on the PHP host.');
    }
    $directory = admin_private_dir();
    $marker = $directory . DIRECTORY_SEPARATOR . 'admin-initialized';
    $statePath = $directory . DIRECTORY_SEPARATOR . 'admin-state.json';
    if (is_file($marker)) {
        if (!is_file($statePath)) {
            throw new AdminApiError(403, 'Admin account is disabled.');
        }
        $state = json_decode(file_get_contents($statePath) ?: '', true);
        if (!is_array($state) || empty($state['password_hash']) || !empty($state['disabled'])) {
            throw new AdminApiError(403, 'Admin account is disabled.');
        }
        return [$email, (string) $state['password_hash'], false];
    }
    return [$email, $initialHash, admin_env('ADMIN_FORCE_PASSWORD_CHANGE', '1') !== '0'];
}

function admin_write_state(array $state): void
{
    $directory = admin_private_dir();
    $path = $directory . DIRECTORY_SEPARATOR . 'admin-state.json';
    $temp = $path . '.' . bin2hex(random_bytes(5)) . '.tmp';
    $json = json_encode($state, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if (file_put_contents($temp, $json, LOCK_EX) === false || !rename($temp, $path)) {
        @unlink($temp);
        throw new AdminApiError(503, 'Could not save admin settings.');
    }
    @chmod($path, 0600);
    $marker = $directory . DIRECTORY_SEPARATOR . 'admin-initialized';
    if (file_put_contents($marker, '1', LOCK_EX) === false) {
        throw new AdminApiError(503, 'Could not secure admin settings.');
    }
    @chmod($marker, 0600);
}

function admin_rate_check(bool $failure = false): void
{
    $path = admin_private_dir() . DIRECTORY_SEPARATOR . 'login-rate.json';
    $lock = fopen($path . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) {
        throw new AdminApiError(503, 'Login protection is unavailable.');
    }
    $records = is_file($path) ? json_decode(file_get_contents($path) ?: '', true) : [];
    if (!is_array($records)) $records = [];
    $now = time();
    foreach ($records as $recordKey => $recordAttempts) {
        $recordAttempts = is_array($recordAttempts) ? array_values(array_filter($recordAttempts, static fn($time) => is_int($time) && $time > $now - 900)) : [];
        if ($recordAttempts) $records[$recordKey] = $recordAttempts; else unset($records[$recordKey]);
    }
    $key = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $attempts = array_values(array_filter($records[$key] ?? [], static fn($time) => is_int($time) && $time > $now - 900));
    if (!$failure && count($attempts) >= 5) {
        flock($lock, LOCK_UN); fclose($lock);
        throw new AdminApiError(429, 'Too many attempts. Wait 15 minutes before trying again.');
    }
    if ($failure) $attempts[] = $now;
    $records = array_filter($records, static fn($list) => is_array($list) && count($list) > 0);
    if ($attempts) $records[$key] = $attempts; else unset($records[$key]);
    $temp = $path . '.' . bin2hex(random_bytes(5)) . '.tmp';
    file_put_contents($temp, json_encode($records), LOCK_EX);
    rename($temp, $path);
    @chmod($path, 0600);
    flock($lock, LOCK_UN); fclose($lock);
}

function admin_github_config(): array
{
    $token = admin_env('GITHUB_TOKEN');
    $owner = admin_env('GITHUB_REPOSITORY_OWNER');
    $repo = admin_env('GITHUB_REPOSITORY_NAME');
    if ($token === '' || $owner === '' || $repo === '') {
        throw new AdminApiError(503, 'GitHub is not connected. Configure the repository settings on the PHP host.');
    }
    $production = admin_env('GITHUB_PRODUCTION_BRANCH', 'main');
    $draft = admin_env('GITHUB_DRAFT_BRANCH', 'aloka-drafts');
    foreach ([$production, $draft] as $branch) {
        if (!preg_match('/^[A-Za-z0-9._\/-]{1,120}$/', $branch) || str_contains($branch, '..')) {
            throw new AdminApiError(503, 'Repository branch configuration is invalid.');
        }
    }
    return [$token, $owner, $repo, $production, $draft];
}

function admin_github(string $method, string $endpoint, ?array $body = null): array
{
    [$token, $owner, $repo] = admin_github_config();
    $url = 'https://api.github.com/repos/' . rawurlencode($owner) . '/' . rawurlencode($repo) . $endpoint;
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => [
            'Accept: application/vnd.github+json',
            'Authorization: Bearer ' . $token,
            'X-GitHub-Api-Version: 2022-11-28',
            'User-Agent: ALOKA-Admin',
            'Content-Type: application/json',
        ],
    ]);
    if ($body !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    $response = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    if ($response === false) throw new AdminApiError(502, $error !== '' ? 'GitHub could not be reached.' : 'GitHub request failed.');
    $data = json_decode($response, true);
    if ($status < 200 || $status >= 300) {
        $message = $status === 404 ? 'The requested GitHub file or branch was not found.' : ($status === 409 || $status === 422 ? 'GitHub could not apply this change; refresh and retry.' : 'GitHub rejected the request. Check repository permissions and settings.');
        throw new AdminApiError($status === 404 ? 404 : ($status === 409 ? 409 : 502), $message);
    }
    return is_array($data) ? $data : [];
}

function admin_repo_path(string $path): string
{
    $path = trim($path);
    if ($path === '' || strlen($path) > 500 || str_contains($path, "\0") || str_contains($path, '\\') || str_starts_with($path, '/') || preg_match('/(^|\/)\.{1,2}(\/|$)/', $path)) {
        throw new AdminApiError(400, 'Repository path is invalid.');
    }
    $parts = explode('/', $path);
    foreach ($parts as $part) {
        if ($part === '' || $part === '.git' || preg_match('/[<>:"|?*\x00-\x1F]/', $part)) throw new AdminApiError(400, 'Repository path is invalid.');
    }
    return $path;
}

function admin_supported_text(string $path): void
{
    if (!preg_match('/\.(html?|css|js|mjs|cjs|json|md|txt|xml|svg|ya?ml|toml|csv|sql|php|sh|py|java|c|h|cpp|hpp|ts|tsx|jsx)$/i', $path)) {
        throw new AdminApiError(415, 'This file type cannot be opened in the code editor.');
    }
}

function admin_branch_ref(string $branch): string
{
    try {
        return (string) admin_github('GET', '/git/ref/heads/' . rawurlencode($branch))['object']['sha'];
    } catch (AdminApiError $error) {
        if ($error->httpStatus !== 404) throw $error;
        throw $error;
    }
}

function admin_ensure_draft_branch(): void
{
    [, , , $production, $draft] = admin_github_config();
    try { admin_branch_ref($draft); return; } catch (AdminApiError $error) { if ($error->httpStatus !== 404) throw $error; }
    $sha = admin_branch_ref($production);
    admin_github('POST', '/git/refs', ['ref' => 'refs/heads/' . $draft, 'sha' => $sha]);
}

function admin_contents_endpoint(string $path, string $branch): string
{
    $encoded = implode('/', array_map('rawurlencode', explode('/', $path)));
    return '/contents/' . $encoded . '?ref=' . rawurlencode($branch);
}

function admin_tree(string $branch): array
{
    $sha = admin_branch_ref($branch);
    $tree = admin_github('GET', '/git/trees/' . rawurlencode($sha) . '?recursive=1');
    if (!empty($tree['truncated'])) throw new AdminApiError(502, 'Repository is too large to list safely.');
    return array_values(array_filter($tree['tree'] ?? [], static fn($entry) => ($entry['type'] ?? '') === 'blob'));
}

function admin_save_draft(string $path, string $content, string $message): array
{
    admin_repo_path($path); admin_supported_text($path); admin_ensure_draft_branch();
    if (str_contains($content, "\0")) throw new AdminApiError(415, 'Binary files cannot be edited in the text editor.');
    [, , , , $draft] = admin_github_config();
    $sha = null;
    try { $current = admin_github('GET', admin_contents_endpoint($path, $draft)); $sha = $current['sha'] ?? null; } catch (AdminApiError $error) { if ($error->httpStatus !== 404) throw $error; }
    $message = preg_match('//u', $message) ? $message : 'Update ' . basename($path);
    $message = preg_replace('/^(.{0,120}).*$/us', '$1', $message) ?: 'Update ' . basename($path);
    $body = ['message' => $message, 'content' => base64_encode($content), 'branch' => $draft];
    if ($sha) $body['sha'] = $sha;
    return admin_github('PUT', '/contents/' . implode('/', array_map('rawurlencode', explode('/', $path))), $body);
}

function admin_compare(string $production, string $draft): array
{
    $comparison = admin_github('GET', '/compare/' . rawurlencode($production) . '...' . rawurlencode($draft));
    if (count($comparison['files'] ?? []) >= 300) throw new AdminApiError(413, 'GitHub limits the review list to 300 files. Reduce the draft set before publishing.');
    return $comparison;
}
