#!/bin/sh
set -eu

port="${PORT:-10000}"
case "$port" in
  ''|*[!0-9]*) echo "PORT must be numeric" >&2; exit 1 ;;
esac

mkdir -p /var/data/aloka/sessions
chown -R www-data:www-data /var/data/aloka
sed -i "s/^Listen 80$/Listen ${port}/" /etc/apache2/ports.conf
sed -i "s/:80>/:${port}>/" /etc/apache2/sites-available/000-default.conf
exec "$@"
