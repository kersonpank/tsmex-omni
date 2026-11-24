# Serviço de backup do TSM EX (produção): pg_dump cifrado + espelho do bucket para fora do servidor,
# teste de restauração semanal e registro de cada execução na tabela BackupRun.
FROM postgres:16-alpine

RUN apk add --no-cache bash coreutils curl rclone age tzdata

ENV TZ=America/Sao_Paulo \
    BACKUP_STATE_DIR=/var/lib/tsmex-backup

COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
    && mkdir -p /var/lib/tsmex-backup && chown -R postgres:postgres /var/lib/tsmex-backup

# Sem root no processo de backup: o usuário postgres da imagem basta para pg_dump/psql/rclone.
USER postgres
WORKDIR /var/lib/tsmex-backup

ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["loop"]
