FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev \
    && docker-php-ext-install curl \
    && rm -rf /var/lib/apt/lists/*

COPY api/admin.php /var/www/html/api/admin.php
COPY api/admin-common.php /var/www/html/api/admin-common.php
COPY api/health.php /var/www/html/api/health.php
COPY deploy/render/aloka-sessions.ini /usr/local/etc/php/conf.d/aloka-sessions.ini
COPY deploy/render/start.sh /usr/local/bin/aloka-start

RUN sed -i 's/\r$//' /usr/local/bin/aloka-start && chmod 755 /usr/local/bin/aloka-start
ENV ALOKA_PRIVATE_DIR=/var/data/aloka
EXPOSE 10000
ENTRYPOINT ["/usr/local/bin/aloka-start"]
CMD ["apache2-foreground"]
