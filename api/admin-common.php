<?php
declare(strict_types=1);

// Local-only config.php is gitignored; production credentials come from the PHP host environment.
$localAdminConfig = __DIR__ . '/config.php';
if (is_file($localAdminConfig)) require_once $localAdminConfig;
if (PHP_SAPI === 'cli-server' && is_file(dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env')) {
    foreach (file(dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (!preg_match('/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/', $line, $match) || getenv($match[1]) !== false) continue;
        $value = trim($match[2]);
        if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) $value = substr($value, 1, -1);
        putenv($match[1] . '=' . $value);
    }
}

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
    if ($initialHash === '' || !password_get_info($initialHash)['algo']) {
        $initialPassword = admin_env('ADMIN_PASSWORD');
        $initialHash = $initialPassword === '' ? '' : password_hash($initialPassword, PASSWORD_DEFAULT);
    }
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
    if (PHP_OS_FAMILY === 'Windows' && !ini_get('curl.cainfo') && defined('CURLSSLOPT_NATIVE_CA')) {
        curl_setopt($curl, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
    }
    if ($body !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    $response = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    if ($response === false) throw new AdminApiError(502, $error !== '' ? 'GitHub could not be reached.' : 'GitHub request failed.');
    $data = json_decode($response, true);
    if ($status < 200 || $status >= 300) {
        $message = $status === 404 ? 'The requested GitHub file or branch was not found.' : ($status === 409 || $status === 422 ? 'GitHub could not apply this change; refresh and retry.' : 'GitHub rejected the request. Check repository permissions and settings.');
        throw new AdminApiError($status === 404 ? 404 : ($status === 409 ? 409 : 502), $message);
    }
    return is_array($data) ? $data : [];
}

function admin_contents_endpoint(string $path, string $branch): string
{
    $encoded = implode('/', array_map('rawurlencode', explode('/', $path)));
    return '/contents/' . $encoded . '?ref=' . rawurlencode($branch);
}

function admin_catalog_read(string $name): array
{
    if (!in_array($name, ['experiments', 'subjects', 'categories', 'viva'], true)) throw new AdminApiError(400, 'Content collection is invalid.');
    [, , , $production] = admin_github_config();
    try {
        $file = admin_github('GET', admin_contents_endpoint('data/' . $name . '.json', $production));
    } catch (AdminApiError $error) {
        if ($error->httpStatus === 404) return ['items' => [], 'sha' => null];
        throw $error;
    }
    $content = base64_decode(preg_replace('/\s+/', '', (string) ($file['content'] ?? '')), true);
    $items = $content === false ? null : json_decode($content, true);
    if (!is_array($items) || !array_is_list($items)) throw new AdminApiError(502, 'Published content is not a valid JSON list.');
    return ['items' => $items, 'sha' => (string) ($file['sha'] ?? '')];
}

function admin_catalog_write(string $name, array $items, ?string $expectedSha, string $message): array
{
    if (!in_array($name, ['experiments', 'subjects', 'categories', 'viva'], true)) throw new AdminApiError(400, 'Content collection is invalid.');
    $current = admin_catalog_read($name);
    if ($current['sha'] !== $expectedSha) throw new AdminApiError(409, 'This content changed elsewhere. Refresh before saving again.');
    [, , , $production] = admin_github_config();
    $content = json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
    if (strlen($content) > 2_000_000) throw new AdminApiError(413, 'Content exceeds the 2 MB limit.');
    $body = ['message' => substr($message, 0, 120), 'content' => base64_encode($content), 'branch' => $production];
    if ($current['sha'] !== null) $body['sha'] = $current['sha'];
    return admin_github('PUT', '/contents/data/' . $name . '.json', $body);
}

function admin_experiment_drafts_read(): array
{
    $path = admin_private_dir() . DIRECTORY_SEPARATOR . 'experiment-drafts.json';
    if (!is_file($path)) return [];
    $items = json_decode(file_get_contents($path) ?: '', true);
    if (!is_array($items) || !array_is_list($items)) throw new AdminApiError(503, 'Private experiment drafts could not be read.');
    return $items;
}

function admin_experiment_drafts_update(callable $update): mixed
{
    $path = admin_private_dir() . DIRECTORY_SEPARATOR . 'experiment-drafts.json';
    $lock = fopen($path . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new AdminApiError(503, 'Private experiment drafts are unavailable.');
    @chmod($path . '.lock', 0600);
    try {
        $drafts = is_file($path) ? json_decode(file_get_contents($path) ?: '', true) : [];
        if (!is_array($drafts) || !array_is_list($drafts)) throw new AdminApiError(503, 'Private experiment drafts could not be read.');
        [$next, $result] = $update($drafts);
        $json = json_encode($next, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
        $temp = $path . '.' . bin2hex(random_bytes(5)) . '.tmp';
        if (file_put_contents($temp, $json, LOCK_EX) === false || !rename($temp, $path)) {
            @unlink($temp);
            throw new AdminApiError(503, 'Private experiment drafts could not be saved.');
        }
        @chmod($path, 0600);
        return $result;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function admin_experiment_text(array $input, string $field, int $limit, bool $required = false): string
{
    $value = $input[$field] ?? '';
    if (!is_string($value)) throw new AdminApiError(400, ucfirst($field) . ' must be text.');
    if (strlen($value) > $limit || str_contains($value, "\0")) throw new AdminApiError(400, ucfirst($field) . ' is too long or contains invalid characters.');
    if ($required && trim($value) === '') throw new AdminApiError(400, ucfirst($field) . ' is required.');
    return $required ? trim($value) : $value;
}

function admin_experiment_list_field(array $input, string $field, int $itemsLimit, int $textLimit): array
{
    $values = $input[$field] ?? [];
    if (!is_array($values) || count($values) > $itemsLimit) throw new AdminApiError(400, ucfirst($field) . ' list is invalid.');
    $clean = [];
    foreach ($values as $value) {
        if (!is_string($value) || strlen($value) > $textLimit || str_contains($value, "\0")) throw new AdminApiError(400, ucfirst($field) . ' contains invalid text.');
        $value = trim($value);
        if ($value !== '' && !in_array($value, $clean, true)) $clean[] = $value;
    }
    return $clean;
}

function admin_validate_experiment(array $input): array
{
    $id = strtolower(trim(admin_experiment_text($input, 'id', 100, true)));
    $slug = strtolower(trim(admin_experiment_text($input, 'slug', 100, true)));
    if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $id) || $slug !== $id) throw new AdminApiError(400, 'Use the unique slug as the experiment identifier.');
    $questions = $input['vivaQuestions'] ?? [];
    if (!is_array($questions) || count($questions) > 100) throw new AdminApiError(400, 'Viva question list is invalid.');
    $viva = [];
    foreach ($questions as $question) {
        if (!is_array($question)) throw new AdminApiError(400, 'Viva question entry is invalid.');
        $viva[] = [
            'question' => trim(admin_experiment_text($question, 'question', 2000, true)),
            'answer' => trim(admin_experiment_text($question, 'answer', 5000, true)),
            'difficulty' => trim(admin_experiment_text($question, 'difficulty', 40)),
            'topic' => trim(admin_experiment_text($question, 'topic', 100)),
        ];
    }
    $sourceCode = admin_experiment_text($input, 'sourceCode', 1_500_000);
    if (trim($sourceCode) === '') throw new AdminApiError(400, 'Source code is required.');
    $record = [
        'id' => $id,
        'slug' => $slug,
        'title' => trim(admin_experiment_text($input, 'title', 160, true)),
        'subject' => admin_experiment_text($input, 'subject', 100, true),
        'category' => trim(admin_experiment_text($input, 'category', 100)),
        'aim' => trim(admin_experiment_text($input, 'aim', 5000)),
        'description' => trim(admin_experiment_text($input, 'description', 1500)),
        'language' => trim(admin_experiment_text($input, 'language', 60, true)),
        'sourceCode' => $sourceCode,
        'experimentNumber' => trim(admin_experiment_text($input, 'experimentNumber', 60)),
        'difficulty' => trim(admin_experiment_text($input, 'difficulty', 40)),
        'prerequisites' => admin_experiment_list_field($input, 'prerequisites', 30, 300),
        'algorithm' => trim(admin_experiment_text($input, 'algorithm', 8000)),
        'procedure' => admin_experiment_list_field($input, 'procedure', 80, 1000),
        'explanation' => trim(admin_experiment_text($input, 'explanation', 12000)),
        'expectedOutput' => admin_experiment_text($input, 'expectedOutput', 8000),
        'sampleInput' => admin_experiment_text($input, 'sampleInput', 4000),
        'sampleOutput' => admin_experiment_text($input, 'sampleOutput', 4000),
        'timeComplexity' => trim(admin_experiment_text($input, 'timeComplexity', 100)),
        'spaceComplexity' => trim(admin_experiment_text($input, 'spaceComplexity', 100)),
        'referenceNotes' => trim(admin_experiment_text($input, 'referenceNotes', 6000)),
        'tags' => admin_experiment_list_field($input, 'tags', 40, 60),
        'vivaQuestions' => $viva,
    ];
    return $record;
}
