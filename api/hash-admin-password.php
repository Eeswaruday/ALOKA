<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$password = rtrim(stream_get_contents(STDIN), "\r\n");
if (strlen($password) < 12 || strlen($password) > 128 || !preg_match('/[A-Za-z]/', $password) || !preg_match('/[0-9]/', $password)) {
    fwrite(STDERR, "Use 12–128 characters with at least one letter and one number.\n");
    exit(1);
}
echo password_hash($password, PASSWORD_DEFAULT), PHP_EOL;
$password = '';
