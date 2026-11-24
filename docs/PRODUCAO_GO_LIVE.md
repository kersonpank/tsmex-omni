# Produção — go-live e convivência com o sistema legado

Runbook da entrada em produção do TSM EX e dos 6 meses em que o sistema legado fica de retaguarda.
Vale junto com [STACK_ENV_MATRIX.md](STACK_ENV_MATRIX.md) (variáveis) e
[STACK_ROLLOUT_RUNBOOK.md](STACK_ROLLOUT_RUNBOOK.md) (stack no Swarm).

**Regra mestra da convivência:** uma única autoridade emissora por operação e **cada sistema na sua
série**. O TSM nunca emite na série que o legado usa, e vice-versa.

---

## 1. Servidor de produção

- **Servidor dedicado** para produção. Não dividir com o staging nem com stacks de outros clientes:
  a rede `ProxyGM` é compartilhada e já fez o staging falar com o Redis de outro cliente.
- No mínimo 4 vCPU, 8 GB de RAM e 160 GB de SSD, com snapshot diário do provedor ligado. O snapshot é
  uma camada a mais, **não substitui** o backup externo.
- `DATABASE_URL` sempre com o host qualificado `tsmexomni-prod_postgres`. O deploy recusa o host curto
  `postgres`.
- Fuso do servidor: `America/Sao_Paulo`.

## 2. Segredos — quem guarda o quê

| Segredo | Onde fica | Cópia offline obrigatória |
|---|---|---|
| `FISCAL_SECRET_KEY` | Stack (Portainer) | **Sim.** Sem ela, as senhas do certificado A1 e da AT&M ficam irrecuperáveis |
| `JWT_SECRET` | Stack | Não (trocar só derruba as sessões) |
| `POSTGRES_PASSWORD`, `MINIO_ROOT_*`, `S3_*` | Stack | Sim |
| Chave **privada** do backup (age) | **Só** no cofre da empresa (gerenciador de senhas + papel/pendrive no cofre físico) | É a cópia |
| ACBr/e-Frete de produção | GitHub → Settings → Environments → `production` (reaplicados a cada deploy) | Sim |
| `OPS_ALERT_WEBHOOK_URL/TOKEN` | GitHub Environment `production` | Não |

O GitHub Environment `production` precisa ter **Required reviewers** (ao menos 1 pessoa além de quem
dispara o deploy). O workflow já declara `environment: production` e só aceita a branch `main`.

## 3. Backup

### O que roda sozinho (serviço `backup` do stack)

| Cópia | Frequência | Retenção no destino externo |
|---|---|---|
| Banco: `pg_dump` cifrado com age | a cada hora (perda máxima de 1 h) | por hora: 3 dias · diário: 35 dias · mensal: **não apaga** (guarda fiscal ≥ 5 anos) |
| Pacote de contingência (CSV cifrado) | a cada backup do banco | `latest` + 7 dias de histórico |
| Arquivos (bucket do MinIO: XML, comprovantes, certificados) | a cada 6 h | espelho + `objects-history/<dia>` com tudo que foi apagado ou sobrescrito |
| Teste de restauração | semanal | — (restaura o último dump num banco temporário e confere as tabelas) |
| Backup antes de toda migração | a cada deploy | — (se falhar, o deploy para) |

- Cada execução grava uma linha em `BackupRun`. O worker abre alerta **CRÍTICO** (que vai para o
  webhook) se o banco ou os arquivos ficarem mais de 26 h sem sucesso, ou se o teste de restauração
  falhar. A torre vê o estado em **Gestão → Sistema → Backup e contingência**.
- O XML dos CT-e e MDF-e externos (legado) fica **no banco** (`ExternalFiscalDocument.xml`), então
  entra no dump.

### Preparar o destino externo (uma vez)

1. Contratar um S3 de **outro provedor** (Backblaze B2, Wasabi, AWS S3 São Paulo…). Criar o bucket com
   **versionamento** e, se o provedor oferecer, **object lock** de 30 dias.
2. Criar uma chave de acesso **só para esse bucket**, de preferência sem permissão de apagar.
3. Gerar o par de chaves do backup numa máquina da empresa (não no servidor):

   ```bash
   age-keygen -o tsmex-backup.key
   ```

   A linha `# public key: age1…` vai em `BACKUP_AGE_RECIPIENT`. O arquivo `tsmex-backup.key` vai para o
   cofre e **não fica no servidor**.
4. Preencher no stack: `BACKUP_OFFSITE_BUCKET`, `BACKUP_OFFSITE_ENDPOINT`, `BACKUP_OFFSITE_PROVIDER`,
   `BACKUP_OFFSITE_REGION`, `BACKUP_OFFSITE_ACCESS_KEY`, `BACKUP_OFFSITE_SECRET_KEY` e
   `BACKUP_AGE_RECIPIENT`.
5. Conferir na torre que as três linhas ficam **Em dia** (a primeira rodada sai em até 1 minuto, e o
   teste de restauração na primeira hora).

### Restauração (procedimento manual — treinar a cada 3 meses)

Na máquina que vai restaurar (pode ser um servidor novo), com a imagem `tsmex-backup`, as variáveis
`BACKUP_OFFSITE_*` e a chave privada montada **só durante a restauração**:

```bash
docker run --rm -it -e BACKUP_OFFSITE_BUCKET -e RCLONE_CONFIG_OFFSITE_TYPE=s3 -e RCLONE_CONFIG_OFFSITE_PROVIDER -e RCLONE_CONFIG_OFFSITE_ENDPOINT -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY -v "$PWD:/work" -w /work -v /caminho/tsmex-backup.key:/run/secrets/age.key:ro -e BACKUP_AGE_IDENTITY_FILE=/run/secrets/age.key --entrypoint restore.sh ghcr.io/kersonpank/tsmex-omni/tsmex-backup:latest list
```

1. `restore.sh list`: escolher o dump (o mais recente de `hourly`, ou o de um dia em `daily`).
2. `restore.sh fetch postgres/hourly/tsmex-AAAAMMDDTHHMMSS.dump.age`: baixa, confere o sha256 e decifra.
3. Subir um Postgres **vazio** e rodar `restore.sh into postgresql://…/tsmex`. O script recusa banco que
   não esteja vazio.
4. Subir o stack apontando para esse banco. O `migrate` só aplica o que faltar.
5. Arquivos: `rclone sync offsite:<bucket>/tsmex-prod/objects local:<bucket-novo>`.
6. Anotar quanto tempo levou (meta: menos de 4 h) e o que travou.

## 4. Alertas para fora da tela

O `SystemAlert` só aparece no painel. Para alguém ser acordado, configure o webhook:

- `OPS_ALERT_WEBHOOK_URL`: um webhook do n8n que repassa para WhatsApp/e-mail do plantão. O corpo é JSON
  com `text` pronto para mandar como mensagem, mais `severity`, `source`, `title`, `detail` e
  `environment`.
- `OPS_ALERT_WEBHOOK_TOKEN` (opcional): vai como `Authorization: Bearer`. Valide no n8n.
- **O que dispara:**
  - erro 500 da API (agrupado: 1 aviso por rota e erro a cada 10 min);
  - queda de processo (api/worker);
  - `SystemAlert` CRÍTICO de sistema: fila de CT-e pausada, número pulado por conflito com o legado,
    backup atrasado;
  - falha do próprio serviço de backup.

  As exceções operacionais do hub **não** vão para o webhook: elas têm fila, dono e prazo.
- Monitor externo de disponibilidade (UptimeRobot, Better Stack…) em `https://tsmex.com.br/api/health`,
  esperando HTTP 200. A resposta 503 já significa banco ou worker fora.

## 5. Segurança de acesso

- Sessão revogável: trocar ou resetar senha, "Sair de todos os aparelhos" (`/hubs/conta`) e desativar
  usuário derrubam todos os tokens daquele usuário na hora.
- **Torre:** Gestão → Rede → Hubs → Operadores tem Redefinir senha, Encerrar sessões e Desativar acesso.
  Desligou alguém? Desative no mesmo dia.
- Senha nova: 10+ caracteres, com letras e números. Senhas antigas continuam valendo até a troca.
- Trilha de auditoria (`GET /api/audit-log`, ADMIN): toda escrita autenticada, toda tentativa de login e
  as leituras sensíveis (download do certificado A1, relatórios, pacote de contingência). Não guarda o
  corpo das requisições.
- Rate limit contado no Redis: as réplicas da API somam o mesmo limite.

## 6. Numeração fiscal na convivência

1. **Antes do corte, importar o arquivo fiscal do legado** (export de 21/10/2026 e o que vier depois):

   ```bash
   docker exec -it $(docker ps -q -f name=tsmexomni-prod_api | head -1) node dist/scripts/importExternalFiscal.js /dados/xml-legado --dry-run
   docker exec -it $(docker ps -q -f name=tsmexomni-prod_api | head -1) node dist/scripts/importExternalFiscal.js /dados/xml-legado --note "export legado 2026-10-21"
   ```

   Copie a pasta para dentro do container antes, com `docker cp`. O script é idempotente e gera um CSV de
   conferência; ele recusa chave com DV inválido e documento sem protocolo. Importe também os eventos
   (cancelamento, encerramento): eles entram depois dos documentos.
2. **Escolher a série do TSM** (CT-e e MDF-e, por emitente) **diferente** da série do legado. Exemplo: o
   legado segue na série 1 e o TSM usa a série 2, começando do número 1. Confirmar com a contabilidade.
   Não usar as séries 890 a 999, que são reservadas.
3. Em **Gestão → Sistema → Fiscal → Numeração fiscal**, conferir que a série do TSM aparece como
   **Série livre** em cada emitente.
4. Virar o emitente para **Produção** no cadastro. O sistema exige marcar "Conferi a série e o último
   número", e em produção o último número **só anda para frente**.
5. Rede de segurança: se mesmo assim o TSM for usar um número que o legado já emitiu na mesma série,
   CNPJ e ambiente, a reserva **pula** esse número e abre alerta CRÍTICO. O número do legado é um número
   usado de verdade, então pular não cria lacuna. Mas o alerta significa que os dois estão na mesma
   série: corrigir na hora.

**Regras de convivência por documento:**
- quem emitiu o CT-e é quem cancela e quem corrige;
- quem abriu o MDF-e é quem encerra;
- quem emitiu é quem averba na AT&M;
- o CIOT tem um único dono por viagem.

## 6.1 Cadastros do legado (pessoas, veículos, motoristas)

As listagens do legado exportam CSV. O importador lê `;` ou `,`, UTF-8 ou ISO-8859-1, e reconhece os
nomes de coluna mais comuns ("Razão Social", "CNPJ/CPF", "Placa", "RENAVAM", "Eixos", "Tara", "CNH"…).

```bash
docker exec -it <api> node dist/scripts/importLegacyMasterData.js persons /dados/pessoas.csv --dry-run
docker exec -it <api> node dist/scripts/importLegacyMasterData.js persons /dados/pessoas.csv
docker exec -it <api> node dist/scripts/importLegacyMasterData.js vehicles /dados/veiculos.csv
docker exec -it <api> node dist/scripts/importLegacyMasterData.js drivers /dados/motoristas.csv
```

- Ordem: **pessoas → veículos → motoristas**. O proprietário do veículo é ligado pela pessoa já
  importada.
- Identidade pela chave natural: CPF/CNPJ (com DV conferido) e placa.
- O que já existe no TSM **só tem lacunas preenchidas**: nunca sobrescreve um campo já preenchido. Pode
  rodar de novo sem medo.
- Cada carga gera um CSV de conferência (linha, resultado, motivo). A TSM confere as contagens contra o
  legado e assina.
- Tabelas de frete, títulos em aberto e contas de cliente **não** entram por aqui: são poucas e com
  regra comercial. Lançar pela torre, conferindo uma a uma.

## 7. Contingência: o TSM caiu

1. Confirmar a queda: `/api/health` fora, ou alerta de processo caído.
2. Abrir o pacote mais recente: `contingencia/latest.csv.age` no destino externo, decifrado com a chave
   do cofre.

   ```bash
   age -d -i tsmex-backup.key latest.csv.age > contingencia.csv
   ```

   O pacote lista pedido, situação, hub, partes, NF-e, CT-e/minuta, viagem, placas e MDF-e/CIOT de tudo
   que está em aberto. Com o TSM no ar, o mesmo pacote sai em Gestão → Sistema → Backup e contingência.
3. Continuar no legado **na série dele** (nunca na série do TSM).
4. Ao voltar: importar no TSM os XMLs que o legado emitiu durante a queda (Gestão → Sistema → Fiscal →
   Arquivo fiscal externo → Importar XMLs). Assim o TSM conhece esses números e não colide. Depois,
   registrar nos pedidos o que mudou fisicamente.

## 8. Checklist do corte (rota piloto primeiro)

- [ ] Servidor dedicado no ar e stack com o serviço `backup`
- [ ] Destino externo configurado e as três linhas **Em dia** na torre
- [ ] Uma restauração completa ensaiada num servidor separado, com o tempo anotado
- [ ] Webhook de alerta testado (derrubar o worker de propósito chega no WhatsApp?)
- [ ] Monitor externo em `/api/health`
- [ ] `FISCAL_SECRET_KEY` e a chave privada do backup no cofre, com 2 pessoas sabendo onde estão
- [ ] GitHub Environment `production` com Required reviewers e os secrets de produção
- [ ] Arquivo fiscal do legado importado e conferido (contagem do CSV = export)
- [ ] Pessoas, veículos e motoristas importados (dry-run conferido e assinado)
- [ ] Tabelas de frete e títulos em aberto lançados e conferidos
- [ ] Série exclusiva do TSM por emitente, aprovada pela contabilidade, e **Série livre** na torre
- [ ] Emitente virado para produção (CT-e/MDF-e) e e-Frete/AT&M de produção configurados
- [ ] Certificado A1 válido (vence em set/2027 — alerta da torre)
- [ ] Usuários reais criados com senha forte; contas de teste e seed desativadas
- [ ] Combinado com o dono do legado: acesso e emissão de contingência pelo período da convivência
- [ ] 2 semanas na rota piloto sem divergência, com contagem diária de documentos por sistema
