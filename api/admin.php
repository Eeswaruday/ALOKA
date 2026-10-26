<?php
declare(strict_types=1);
require_once __DIR__ . '/admin-common.php';

try {
    admin_cors_and_session();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $action = $_GET['action'] ?? '';
    if ($method === 'GET' && $action === 'csrf') {
        $_SESSION['admin_csrf'] ??= bin2hex(random_bytes(32));
        admin_json(['csrf' => $_SESSION['admin_csrf'], 'expired' => !empty($_SESSION['admin_expired'])]);
    }
    if ($method === 'GET' && $action === 'status') {
        if (empty($_SESSION['admin_email'])) admin_json(['authenticated' => false]);
        admin_require_auth(true);
        $githubConnected = admin_env('GITHUB_TOKEN') !== '' && admin_env('GITHUB_REPOSITORY_OWNER') !== '' && admin_env('GITHUB_REPOSITORY_NAME') !== '';
        admin_json(['authenticated' => true, 'email' => $_SESSION['admin_email'], 'must_change' => !empty($_SESSION['admin_must_change']), 'github_connected' => $githubConnected, 'csrf' => $_SESSION['admin_csrf'] ?? '']);
    }
    if ($method === 'GET') {
        admin_require_auth();
        [, , , $production, $draft] = admin_github_config();
        if ($action === 'tree') {
            $prefix = trim((string) ($_GET['path'] ?? ''), '/');
            if ($prefix !== '') admin_repo_path($prefix);
            $entries = [];
            foreach (admin_tree($draft) as $entry) {
                $path = (string) ($entry['path'] ?? '');
                if ($prefix !== '' && !str_starts_with($path, $prefix . '/')) continue;
                $rest = $prefix === '' ? $path : substr($path, strlen($prefix) + 1);
                if ($rest === '') continue;
                $parts = explode('/', $rest, 2);
                if (count($parts) === 2) $entries['dir:' . $parts[0]] = ['type' => 'dir', 'name' => $parts[0], 'path' => $prefix === '' ? $parts[0] : $prefix . '/' . $parts[0]];
                else $entries['file:' . $path] = ['type' => 'file', 'name' => $parts[0], 'path' => $path, 'size' => (int) ($entry['size'] ?? 0)];
            }
            uasort($entries, static fn($a, $b) => ($a['type'] === $b['type'] ? strcasecmp($a['name'], $b['name']) : ($a['type'] === 'dir' ? -1 : 1)));
            admin_json(['entries' => array_values($entries), 'path' => $prefix]);
        }
        if ($action === 'count') {
            $path = admin_repo_path((string) ($_GET['path'] ?? ''));
            $files = array_filter(admin_tree($draft), static fn($entry) => ($entry['path'] ?? '') === $path || str_starts_with((string) ($entry['path'] ?? ''), $path . '/'));
            admin_json(['count' => count($files)]);
        }
        if ($action === 'open') {
            $path = admin_repo_path((string) ($_GET['path'] ?? ''));
            admin_supported_text($path);
            $file = admin_github('GET', admin_contents_endpoint($path, $draft));
            $content = base64_decode((string) ($file['content'] ?? ''), true);
            if ($content === false || strlen($content) > 2_000_000) throw new AdminApiError(413, 'This file is too large to open in the editor.');
            admin_json(['path' => $path, 'content' => $content, 'sha' => $file['sha'] ?? null]);
        }
        if ($action === 'history') {
            $path = isset($_GET['path']) && $_GET['path'] !== '' ? '&path=' . rawurlencode(admin_repo_path((string) $_GET['path'])) : '';
            $commits = admin_github('GET', '/commits?sha=' . rawurlencode($production) . $path . '&per_page=30');
            admin_json(['commits' => array_map(static fn($commit) => ['sha' => $commit['sha'] ?? '', 'message' => $commit['commit']['message'] ?? '', 'date' => $commit['commit']['author']['date'] ?? '', 'author' => $commit['commit']['author']['name'] ?? ''], $commits)]);
        }
        if ($action === 'preview') {
            $comparison = admin_compare($production, $draft);
            admin_json(['ahead_by' => (int) ($comparison['ahead_by'] ?? 0), 'behind_by' => (int) ($comparison['behind_by'] ?? 0), 'files' => array_map(static fn($file) => ['path' => $file['filename'] ?? '', 'status' => $file['status'] ?? 'modified', 'additions' => $file['additions'] ?? 0, 'deletions' => $file['deletions'] ?? 0], $comparison['files'] ?? [])]);
        }
        throw new AdminApiError(404, 'Unknown admin action.');
    }
    if ($method !== 'POST') throw new AdminApiError(405, 'Method not allowed.');
    admin_require_csrf();
    if ($action === 'login') {
        admin_rate_check();
        [$email, $hash, $mustChange] = admin_credentials();
        $input = admin_read_json();
        $submittedEmail = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        if (strlen($password) > 1024 || !hash_equals($email, $submittedEmail) || !password_verify($password, $hash)) {
            admin_rate_check(true);
            throw new AdminApiError(401, 'Email or password is incorrect.');
        }
        admin_rate_check_clear();
        session_regenerate_id(true);
        unset($_SESSION['admin_expired']);
        $_SESSION['admin_email'] = $email;
        $_SESSION['admin_must_change'] = $mustChange;
        $_SESSION['admin_created_at'] = time();
        $_SESSION['admin_last_seen'] = time();
        $_SESSION['admin_csrf'] = bin2hex(random_bytes(32));
        admin_json(['ok' => true, 'must_change' => $mustChange, 'csrf' => $_SESSION['admin_csrf']]);
    }
    if ($action === 'logout') {
        admin_require_auth(true);
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', ['expires' => time() - 42000, 'path' => $params['path'], 'secure' => $params['secure'], 'httponly' => true, 'samesite' => 'Strict']);
        }
        session_destroy();
        admin_json(['ok' => true]);
    }
    if ($action === 'change-password') {
        admin_require_auth(true);
        $input = admin_read_json();
        [, $currentHash] = admin_credentials();
        $current = (string) ($input['current_password'] ?? '');
        $next = (string) ($input['new_password'] ?? '');
        if (!password_verify($current, $currentHash)) throw new AdminApiError(401, 'Current password is incorrect.');
        if (strlen($next) < 12 || strlen($next) > 128 || !preg_match('/[A-Za-z]/', $next) || !preg_match('/[0-9]/', $next)) {
            throw new AdminApiError(400, 'Use at least 12 characters, including a letter and a number.');
        }
        admin_write_state(['password_hash' => password_hash($next, PASSWORD_DEFAULT), 'disabled' => false, 'updated_at' => gmdate(DATE_ATOM)]);
        $_SESSION['admin_must_change'] = false;
        admin_json(['ok' => true]);
    }

    admin_require_auth();
    $input = str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') ? admin_read_json() : [];
    if ($action === 'init-drafts') {
        admin_ensure_draft_branch();
        admin_json(['ok' => true]);
    }
    [, , , $production, $draft] = admin_github_config();

    if ($action === 'save') {
        $path = admin_repo_path((string) ($input['path'] ?? ''));
        $content = (string) ($input['content'] ?? '');
        if (strlen($content) > 2_000_000) throw new AdminApiError(413, 'File content exceeds the 2 MB limit.');
        $saved = admin_save_draft($path, $content, (string) ($input['message'] ?? 'Update ' . basename($path)));
        admin_json(['ok' => true, 'path' => $path, 'commit' => $saved['commit']['sha'] ?? '']);
    }
    if ($action === 'delete') {
        $path = admin_repo_path((string) ($input['path'] ?? ''));
        admin_ensure_draft_branch();
        $files = array_values(array_filter(admin_tree($draft), static fn($entry) => ($entry['path'] ?? '') === $path || str_starts_with((string) ($entry['path'] ?? ''), $path . '/')));
        if (!$files) throw new AdminApiError(404, 'No draft files match this path.');
        if (count($files) > 100) throw new AdminApiError(413, 'This folder has more than 100 files. Split the deletion into smaller folders.');
        if ((int) ($input['confirm_count'] ?? -1) !== count($files)) throw new AdminApiError(409, 'The folder contents changed. Refresh the file list and confirm again.');
        foreach ($files as $entry) {
            $file = admin_github('GET', admin_contents_endpoint($entry['path'], $draft));
            admin_github('DELETE', '/contents/' . implode('/', array_map('rawurlencode', explode('/', $entry['path']))), ['message' => 'Stage deletion of ' . $entry['path'], 'sha' => $file['sha'], 'branch' => $draft]);
        }
        admin_json(['ok' => true, 'deleted_files' => count($files)]);
    }
    if ($action === 'upload') {
        admin_ensure_draft_branch();
        $base = trim((string) ($_POST['path'] ?? ''), '/');
        if ($base !== '') admin_repo_path($base);
        $names = $_FILES['files']['name'] ?? [];
        $temps = $_FILES['files']['tmp_name'] ?? [];
        $errors = $_FILES['files']['error'] ?? [];
        $sizes = $_FILES['files']['size'] ?? [];
        $fullPaths = $_FILES['files']['full_path'] ?? [];
        if (!is_array($names) || count($names) === 0 || count($names) > 25 || array_sum($sizes) > 10_000_000) throw new AdminApiError(400, 'Upload up to 25 files and 10 MB per batch.');
        $uploaded = [];
        foreach ($names as $i => $name) {
            if (($errors[$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || ($sizes[$i] ?? 0) > 2_000_000) throw new AdminApiError(413, 'Each upload must be smaller than 2 MB.');
            $relativeName = is_array($fullPaths) ? ($fullPaths[$i] ?? $name) : $name;
            $relative = str_replace('\\', '/', (string) $relativeName);
            $path = admin_repo_path($base === '' ? $relative : $base . '/' . $relative);
            admin_supported_text($path);
            $content = file_get_contents($temps[$i]);
            if ($content === false || str_contains($content, "\0")) throw new AdminApiError(415, 'Only text files can be uploaded.');
            $uploaded[] = admin_save_draft($path, $content, 'Stage upload of ' . basename($path))['content']['path'] ?? $path;
        }
        admin_json(['ok' => true, 'files' => $uploaded]);
    }
    if ($action === 'preview') {
        $comparison = admin_compare($production, $draft);
        admin_json(['ahead_by' => (int) ($comparison['ahead_by'] ?? 0), 'behind_by' => (int) ($comparison['behind_by'] ?? 0), 'files' => array_map(static fn($file) => ['path' => $file['filename'] ?? '', 'status' => $file['status'] ?? 'modified'], $comparison['files'] ?? [])]);
    }
    if ($action === 'publish') {
        $comparison = admin_compare($production, $draft);
        if (empty($comparison['ahead_by'])) throw new AdminApiError(409, 'There are no draft changes to publish.');
        if (!is_array($input['confirm_paths'] ?? null)) throw new AdminApiError(400, 'Review and confirm the affected files before publishing.');
        $paths = array_map(static fn($file) => $file['filename'] ?? '', $comparison['files'] ?? []);
        sort($paths); $confirmed = $input['confirm_paths']; sort($confirmed);
        if ($paths !== $confirmed) throw new AdminApiError(409, 'The draft changed. Review the current file list and confirm again.');
        $merge = admin_github('POST', '/merges', ['base' => $production, 'head' => $draft, 'commit_message' => 'Publish ALOKA admin drafts']);
        admin_json(['ok' => true, 'commit' => $merge['sha'] ?? '']);
    }
    if ($action === 'restore') {
        $path = admin_repo_path((string) ($input['path'] ?? ''));
        $sha = (string) ($input['sha'] ?? '');
        if (!preg_match('/^[a-f0-9]{40}$/i', $sha)) throw new AdminApiError(400, 'Commit reference is invalid.');
        admin_supported_text($path);
        $file = admin_github('GET', admin_contents_endpoint($path, $sha));
        $content = base64_decode((string) ($file['content'] ?? ''), true);
        if ($content === false || strlen($content) > 2_000_000) throw new AdminApiError(413, 'This file cannot be restored through the editor.');
        $saved = admin_save_draft($path, $content, 'Stage restore of ' . $path . ' from ' . substr($sha, 0, 7));
        admin_json(['ok' => true, 'path' => $path, 'commit' => $saved['commit']['sha'] ?? '']);
    }
    throw new AdminApiError(404, 'Unknown admin action.');
} catch (AdminApiError $error) {
    admin_json(['error' => $error->getMessage()], $error->httpStatus);
} catch (Throwable) {
    admin_json(['error' => 'The admin request could not be completed. Check the PHP server configuration.'], 500);
}

function admin_rate_check_clear(): void
{
    $path = admin_private_dir() . DIRECTORY_SEPARATOR . 'login-rate.json';
    $lock = fopen($path . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new AdminApiError(503, 'Login protection is unavailable.');
    $records = is_file($path) ? json_decode(file_get_contents($path) ?: '', true) : [];
    if (!is_array($records)) $records = [];
    unset($records[hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown')]);
    file_put_contents($path, json_encode($records), LOCK_EX);
    @chmod($path, 0600);
    flock($lock, LOCK_UN); fclose($lock);
}
