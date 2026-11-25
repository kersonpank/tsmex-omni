# Validação no staging antes da produção

O staging (`tsm.mesquitagrupo.com.br`, stack `staging-tsmex-dev`) é onde a migração e as mudanças são
ensaiadas. Na produção só roda o que passou aqui: deploy de versão e a mesma migração, sem ajuste à mão.

## 1. Preparar (uma vez)

| Onde | O quê | Valor |
|---|---|---|
| GitHub → Settings → Environments → `staging` → Secrets | `LEGADO_USUARIO` | login da empresa no legado |
| idem | `LEGADO_SENHA` | senha desse login (troque antes: a atual está escrita em fluxos do n8n) |
| idem | `LEGADO_CONFIG_B64` | conteúdo do arquivo de configuração do extrator (entregue fora do git; não tem senha) |
| idem (já existem para o deploy) | `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | os mesmos do deploy do staging |

O volume dos dados baixados (`staging-tsmex-dev_legacy_staging_data`) é montado no worker pelo próprio
workflow na primeira execução. Não precisa mexer no Portainer.

## 2. Deploy

Push na `develop` → workflow **Staging** publica as imagens e atualiza API, worker, web e migrations.
Conferir: `https://tsm.mesquitagrupo.com.br/api/health` responde 200 e a torre abre.

## 3. Migração do legado (Actions → Migração do legado → alvo `staging`)

1. `iniciar` — login e extração em segundo plano (algumas horas). Um deploy do worker no meio interrompe:
   rode `iniciar` de novo e ele continua de onde parou.
2. `andamento` — até todos os jobs mostrarem arquivos e o log terminar com `fim=0`.
3. `carregar` — histórico, XML fiscal e promoção dos cadastros (clientes, contatos, motoristas, veículos,
   tabelas de preço). Rode primeiro a promoção em simulação e confira o relatório.

## 4. O que conferir pela tela

**Gestão → Sistema**
- [ ] **Histórico do legado**: busca por CNPJ, placa, número de CT-e e de viagem acha o registro.
- [ ] **Arquivo fiscal externo**: CT-e por emitente e mês; contagem bate com o CSV de conferência.
- [ ] **Numeração fiscal**: cada emitente mostra o último número do legado na série 1 (SP perto de
      22.5xx, MA perto de 118). Use **Continuar a numeração** num emitente de homologação e veja o
      próximo CT-e sair com o número seguinte.

**Cadastros**
- [ ] Clientes com CNPJ, endereço, telefones e e-mails; tabela de preço especial ligada à conta.
- [ ] Motoristas (CPF, CNH) e veículos (placa, RENAVAM, tara, capacidade) sem duplicata.

**Viagem (homologação)** — Gestão → Viagens → uma viagem aceita, etapa Documentos
- [ ] Emitir o MDF-e com uma placa que tem MDF-e aberto em outra viagem: o botão trava e mostra qual.
- [ ] Placa com MDF-e aberto só no legado: pede a confirmação "já foi encerrado" antes de emitir.
- [ ] **Ajustes do MDF-e → Cancelar MDF-e → Cancelar e emitir de novo** (justificativa ≥ 15 letras):
      o antigo fica Cancelado com protocolo e sai um novo com os CT-e atuais.
- [ ] **Incluir condutor**: o motorista entra no MDF-e (evento registrado) e na escala da viagem.
- [ ] Depois de 24 h da autorização o cancelamento não aparece; a tela orienta encerrar e emitir outro.

**Segurança e operação**
- [ ] Minha conta → trocar senha e "sair de todos os aparelhos".
- [ ] Usuários → redefinir senha e revogar sessões de outro usuário (ADMIN).
- [ ] Sistema → Backup e contingência: baixar o pacote de contingência (CSV).

Qualquer item que falhar aqui é corrigido no código e passa de novo pelo staging. Só depois disso se
roda a mesma sequência em produção (`docs/PRODUCAO_VPS.md`).
