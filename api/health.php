<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$admin = getenv('ADMIN_ENABLED') === '1' && (getenv('ADMIN_EMAIL') ?: '') !== '' && (getenv('ADMIN_PASSWORD_HASH') ?: '') !== '';
$github = (getenv('GITHUB_TOKEN') ?: '') !== '' && (getenv('GITHUB_REPOSITORY_OWNER') ?: '') !== '' && (getenv('GITHUB_REPOSITORY_NAME') ?: '') !== '';
$resend = (getenv('RESEND_API_KEY') ?: '') !== '';
echo json_encode(['status' => 'ok', 'mode' => 'php-backend', 'integrations' => ['admin' => $admin, 'github' => $github, 'resend' => $resend]], JSON_UNESCAPED_SLASHES);
