<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . '/admin-common.php';
$admin = admin_env('ADMIN_ENABLED') === '1' && admin_env('ADMIN_EMAIL') !== '' && admin_env('ADMIN_PASSWORD_HASH') !== '';
$github = admin_env('GITHUB_TOKEN') !== '' && admin_env('GITHUB_REPOSITORY_OWNER') !== '' && admin_env('GITHUB_REPOSITORY_NAME') !== '';
$resend = admin_env('RESEND_API_KEY') !== '';
echo json_encode(['status' => 'ok', 'mode' => 'php-backend', 'integrations' => ['admin' => $admin, 'github' => $github, 'resend' => $resend]], JSON_UNESCAPED_SLASHES);
