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
        $connected = admin_env('GITHUB_TOKEN') !== '' && admin_env('GITHUB_REPOSITORY_OWNER') !== '' && admin_env('GITHUB_REPOSITORY_NAME') !== '';
        admin_json(['authenticated' => true, 'email' => $_SESSION['admin_email'], 'must_change' => !empty($_SESSION['admin_must_change']), 'github_connected' => $connected, 'csrf' => $_SESSION['admin_csrf'] ?? '']);
    }
    if ($method === 'GET' && $action === 'public-experiments') {
        $published = array_values(array_filter(admin_catalog_read('experiments')['items'], static fn($item) => is_array($item) && ($item['status'] ?? '') === 'published'));
        $subjects = admin_catalog_read('subjects')['items'];
        $categories = admin_catalog_read('categories')['items'];
        foreach ($published as $item) {
            if (!empty($item['subject'])) $subjects[] = $item['subject'];
            if (!empty($item['category'])) $categories[] = $item['category'];
        }
        admin_json(['experiments' => $published, 'subjects' => admin_unique_labels($subjects), 'categories' => admin_unique_labels($categories)]);
    }

    if ($method === 'GET') {
        admin_require_auth();
        if ($action === 'content') {
            $published = array_values(array_filter(admin_catalog_read('experiments')['items'], static fn($item) => is_array($item) && ($item['status'] ?? '') === 'published'));
            $drafts = admin_experiment_drafts_read();
            $subjects = admin_catalog_read('subjects')['items'];
            $categories = admin_catalog_read('categories')['items'];
            foreach (array_merge($published, $drafts) as $item) {
                if (!empty($item['subject'])) $subjects[] = $item['subject'];
                if (!empty($item['category'])) $categories[] = $item['category'];
            }
            usort($published, static fn($a, $b) => strcasecmp((string) ($a['title'] ?? ''), (string) ($b['title'] ?? '')));
            usort($drafts, static fn($a, $b) => strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? '')));
            admin_json([
                'published' => $published,
                'drafts' => $drafts,
                'subjects' => admin_unique_labels($subjects),
                'categories' => admin_unique_labels($categories),
                'stats' => ['published' => count($published), 'drafts' => count($drafts), 'subjects' => count(admin_unique_labels($subjects)), 'categories' => count(admin_unique_labels($categories))],
            ]);
        }
        if ($action === 'history') {
            [, , , $production] = admin_github_config();
            $commits = admin_github('GET', '/commits?sha=' . rawurlencode($production) . '&path=data/experiments.json&per_page=30');
            admin_json(['commits' => array_map(static fn($commit) => ['sha' => $commit['sha'] ?? '', 'message' => $commit['commit']['message'] ?? '', 'date' => $commit['commit']['author']['date'] ?? '', 'author' => $commit['commit']['author']['name'] ?? ''], $commits)]);
        }
        throw new AdminApiError(404, 'Unknown admin action.');
    }

    if ($method !== 'POST') throw new AdminApiError(405, 'Method not allowed.');
    admin_require_csrf();
    $input = admin_read_json();

    if ($action === 'login') {
        admin_rate_check();
        [$email, $hash, $mustChange] = admin_credentials();
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
    if ($action === 'migrate-samples') {
        $result = admin_remove_legacy_samples();
        admin_json(['ok' => true, 'removed' => $result]);
    }
    if ($action === 'save-experiment') {
        if (!is_array($input['experiment'] ?? null)) throw new AdminApiError(400, 'Experiment details are invalid.');
        $record = admin_validate_experiment($input['experiment']);
        $submittedBase = (string) ($input['baseUpdatedAt'] ?? '');
        $expectedDraft = (string) ($input['draftUpdatedAt'] ?? '');
        $published = admin_catalog_read('experiments')['items'];
        $live = null;
        foreach ($published as $item) if (is_array($item) && ($item['id'] ?? '') === $record['id'] && ($item['status'] ?? '') === 'published') { $live = $item; break; }
        $result = admin_experiment_drafts_update(static function (array $drafts) use ($record, $submittedBase, $expectedDraft, $live): array {
            $index = null;
            foreach ($drafts as $i => $item) if (($item['id'] ?? '') === $record['id']) { $index = $i; break; }
            $existing = $index === null ? null : $drafts[$index];
            if ($existing !== null && ($existing['updatedAt'] ?? '') !== $expectedDraft) throw new AdminApiError(409, 'This draft changed elsewhere. Reload it before saving.');
            if ($existing === null && $expectedDraft !== '') throw new AdminApiError(409, 'This draft no longer exists. Refresh the draft list.');
            if ($live !== null) {
                $base = (string) ($existing['baseUpdatedAt'] ?? $submittedBase);
                if ($base === '' || $base !== (string) ($live['updatedAt'] ?? '')) throw new AdminApiError(409, 'The published experiment changed. Reload it before saving a draft.');
                $createdAt = (string) ($live['createdAt'] ?? gmdate(DATE_ATOM));
            } else {
                if ($submittedBase !== '' || !empty($existing['baseUpdatedAt'])) throw new AdminApiError(409, 'The published experiment was removed. Refresh before saving.');
                $base = '';
                $createdAt = (string) ($existing['createdAt'] ?? gmdate(DATE_ATOM));
                foreach ($drafts as $item) if (($item['id'] ?? '') === $record['id'] && $index === null) throw new AdminApiError(409, 'An experiment already uses this identifier.');
            }
            $record['status'] = 'draft';
            $record['createdAt'] = $createdAt;
            $record['updatedAt'] = gmdate(DATE_ATOM);
            $record['baseUpdatedAt'] = $base;
            if ($index === null) $drafts[] = $record; else $drafts[$index] = $record;
            return [$drafts, $record];
        });
        admin_json(['ok' => true, 'experiment' => $result]);
    }
    if ($action === 'publish-experiment') {
        $direct = is_array($input['experiment'] ?? null);
        $rawRecord = $direct ? $input['experiment'] : null;
        $id = strtolower(trim((string) ($direct ? ($rawRecord['id'] ?? '') : ($input['id'] ?? ''))));
        $expectedDraft = (string) ($input['draftUpdatedAt'] ?? '');
        $submittedBase = (string) ($input['baseUpdatedAt'] ?? '');
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $id) || (!$direct && $expectedDraft === '')) throw new AdminApiError(400, 'Experiment identifier is invalid.');
        $drafts = admin_experiment_drafts_read();
        $draft = null;
        foreach ($drafts as $item) if (($item['id'] ?? '') === $id) { $draft = $item; break; }
        if (!$direct && (!$draft || ($draft['updatedAt'] ?? '') !== $expectedDraft)) throw new AdminApiError(409, 'This draft changed or no longer exists. Refresh and retry.');
        $collection = admin_catalog_read('experiments');
        $liveIndex = null;
        foreach ($collection['items'] as $i => $item) if (is_array($item) && ($item['id'] ?? '') === $id && ($item['status'] ?? '') === 'published') { $liveIndex = $i; break; }
        $base = $direct ? $submittedBase : (string) ($draft['baseUpdatedAt'] ?? '');
        if ($direct && $base === '' && $liveIndex !== null) {
            $usedIds = array_fill_keys(array_map(static fn($item) => (string) ($item['id'] ?? ''), array_merge($collection['items'], $drafts)), true);
            $stem = substr($id, 0, 92); $suffix = 2;
            do { $id = $stem . '-' . $suffix++; } while (isset($usedIds[$id]));
            $rawRecord['id'] = $id; $rawRecord['slug'] = $id; $liveIndex = null; $draft = null;
        }
        $record = $direct ? admin_validate_experiment(array_merge($draft ?? ($liveIndex === null ? [] : $collection['items'][$liveIndex]), $rawRecord)) : $draft;
        if ($base === '' && $liveIndex !== null) throw new AdminApiError(409, 'An experiment with this identifier is already published.');
        if ($base !== '' && ($liveIndex === null || (string) ($collection['items'][$liveIndex]['updatedAt'] ?? '') !== $base)) throw new AdminApiError(409, 'The published experiment changed. Reload before publishing.');
        $publishedRecord = $record;
        $publishedRecord['createdAt'] = (string) (($draft['createdAt'] ?? null) ?: ($liveIndex === null ? gmdate(DATE_ATOM) : ($collection['items'][$liveIndex]['createdAt'] ?? gmdate(DATE_ATOM))));
        unset($publishedRecord['baseUpdatedAt']);
        $publishedRecord['status'] = 'published';
        $publishedRecord['updatedAt'] = gmdate(DATE_ATOM);
        if ($liveIndex === null) $publishedRecord['publishedAt'] = $publishedRecord['updatedAt'];
        else $publishedRecord['publishedAt'] = $collection['items'][$liveIndex]['publishedAt'] ?? $publishedRecord['updatedAt'];
        if ($liveIndex === null) $collection['items'][] = $publishedRecord; else $collection['items'][$liveIndex] = $publishedRecord;
        $saved = admin_catalog_write('experiments', $collection['items'], $collection['sha'], 'Publish experiment: ' . $publishedRecord['title']);
        $cleanup = $draft === null;
        if ($draft !== null) try {
            $cleanup = admin_experiment_drafts_update(static function (array $items) use ($id, $expectedDraft): array {
                foreach ($items as $item) if (($item['id'] ?? '') === $id && ($item['updatedAt'] ?? '') !== $expectedDraft) return [$items, false];
                return [array_values(array_filter($items, static fn($item) => ($item['id'] ?? '') !== $id)), true];
            });
        } catch (Throwable) { $cleanup = false; }
        admin_json(['ok' => true, 'commit' => $saved['commit']['sha'] ?? '', 'draft_cleared' => $cleanup]);
    }
    if ($action === 'delete-experiment') {
        $id = strtolower(trim((string) ($input['id'] ?? '')));
        $source = (string) ($input['source'] ?? '');
        $confirmTitle = trim((string) ($input['confirmTitle'] ?? ''));
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $id) || !in_array($source, ['draft', 'published'], true)) throw new AdminApiError(400, 'Experiment selection is invalid.');
        $drafts = admin_experiment_drafts_read();
        if ($source === 'published') {
            $collection = admin_catalog_read('experiments');
            $liveIndex = null;
            foreach ($collection['items'] as $i => $item) if (is_array($item) && ($item['id'] ?? '') === $id && ($item['status'] ?? '') === 'published') { $liveIndex = $i; break; }
            if ($liveIndex === null) throw new AdminApiError(404, 'Published experiment was not found.');
            if (!hash_equals((string) ($collection['items'][$liveIndex]['title'] ?? ''), $confirmTitle)) throw new AdminApiError(400, 'Confirm the experiment title before deleting it.');
            array_splice($collection['items'], $liveIndex, 1);
            $saved = admin_catalog_write('experiments', $collection['items'], $collection['sha'], 'Delete experiment: ' . $confirmTitle);
            $commit = $saved['commit']['sha'] ?? '';
        } else {
            $exists = false;
            foreach ($drafts as $item) if (($item['id'] ?? '') === $id) { $exists = true; if (!hash_equals((string) ($item['title'] ?? ''), $confirmTitle)) throw new AdminApiError(400, 'Confirm the experiment title before deleting it.'); }
            if (!$exists) throw new AdminApiError(404, 'Draft experiment was not found.');
            $commit = '';
        }
        admin_experiment_drafts_update(static function (array $items) use ($id): array {
            return [array_values(array_filter($items, static fn($item) => ($item['id'] ?? '') !== $id)), null];
        });
        admin_json(['ok' => true, 'commit' => $commit]);
    }
    if ($action === 'manage-taxonomy') {
        $kind = (string) ($input['kind'] ?? '');
        $operation = (string) ($input['operation'] ?? '');
        $label = trim((string) ($input['label'] ?? ''));
        if (!in_array($kind, ['subjects', 'categories'], true) || !in_array($operation, ['add', 'remove'], true) || $label === '' || strlen($label) > 100 || preg_match('/[\x00-\x1F]/', $label)) throw new AdminApiError(400, 'Subject or category details are invalid.');
        $collection = admin_catalog_read($kind);
        $items = admin_unique_labels($collection['items']);
        if ($operation === 'add') {
            if (in_array(strtolower($label), array_map('strtolower', $items), true)) throw new AdminApiError(409, 'That subject or category already exists.');
            $items[] = $label;
        } else {
            if (!in_array($label, $items, true)) throw new AdminApiError(404, 'That subject or category was not found.');
            $field = $kind === 'subjects' ? 'subject' : 'category';
            $published = admin_catalog_read('experiments')['items'];
            $drafts = admin_experiment_drafts_read();
            foreach (array_merge($published, $drafts) as $record) if (is_array($record) && strcasecmp((string) ($record[$field] ?? ''), $label) === 0) throw new AdminApiError(409, 'This value is still used by an experiment.');
            $items = array_values(array_filter($items, static fn($item) => $item !== $label));
        }
        $saved = admin_catalog_write($kind, $items, $collection['sha'], ucfirst(rtrim($kind, 's')) . ' ' . $operation . ': ' . $label);
        admin_json(['ok' => true, 'items' => $items, 'commit' => $saved['commit']['sha'] ?? '']);
    }
    throw new AdminApiError(404, 'Unknown admin action.');
} catch (AdminApiError $error) {
    admin_json(['error' => $error->getMessage()], $error->httpStatus);
} catch (Throwable) {
    admin_json(['error' => 'The admin request could not be completed. Check the PHP server configuration.'], 500);
}

function admin_unique_labels(array $items): array
{
    $labels = [];
    foreach ($items as $item) {
        if (!is_string($item)) continue;
        $item = trim($item);
        if ($item !== '' && strlen($item) <= 100 && !in_array(strtolower($item), array_map('strtolower', $labels), true)) $labels[] = $item;
    }
    natcasesort($labels);
    return array_values($labels);
}

function admin_remove_legacy_samples(): int
{
    $marker = admin_private_dir() . DIRECTORY_SEPARATOR . 'legacy-samples-cleaned';
    if (is_file($marker)) return 0;
    $removed = 0;
    $experiments = admin_catalog_read('experiments');
    $sampleIds = ['binary-search', 'bubble-sort', 'ohms-law'];
    $sampleTitles = ['binary search', 'bubble sort', 'ohm’s law verification', "ohm's law verification"];
    $clean = array_values(array_filter($experiments['items'], static function ($item) use (&$removed, $sampleIds, $sampleTitles): bool {
        if (!is_array($item)) return true;
        $id = strtolower((string) ($item['id'] ?? $item['slug'] ?? ''));
        $title = strtolower(trim((string) ($item['title'] ?? '')));
        if (in_array($id, $sampleIds, true) || in_array($title, $sampleTitles, true)) { $removed++; return false; }
        return true;
    }));
    if ($removed > 0) admin_catalog_write('experiments', $clean, $experiments['sha'], 'Remove legacy demonstration experiments');
    $viva = admin_catalog_read('viva');
    $vivaClean = array_values(array_filter($viva['items'], static function ($item) use (&$removed): bool {
        if (!is_array($item)) return true;
        $question = strtolower((string) ($item['question'] ?? ''));
        if (str_contains($question, 'binary search') || str_contains($question, 'bubble sort') || str_contains($question, 'ohm')) { $removed++; return false; }
        return true;
    }));
    if (count($vivaClean) !== count($viva['items'])) admin_catalog_write('viva', $vivaClean, $viva['sha'], 'Remove legacy demonstration viva questions');
    if (file_put_contents($marker, '1', LOCK_EX) === false) throw new AdminApiError(503, 'Legacy cleanup could not be recorded.');
    @chmod($marker, 0600);
    return $removed;
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
