# Extrator do sistema legado (só leitura)

Leva o histórico da TransMesquita do sistema legado para o TSM: pessoas, pedidos, cotações, viagens,
financeiro e o que mais as listagens dele devolvem. Usa o login da própria empresa. **Não grava nada lá.**

## Por que é seguro

- **Lista fechada:** só os caminhos declarados nos `jobs` são chamados. Qualquer outro é recusado.
- **Palavras de ação bloqueadas:** emitir, cancelar, excluir, gravar, enviar, importar, gerar,
  autorizar, averbar, baixar título e outras. Checadas no caminho, no nome dos parâmetros e no valor
  de `acao`/`op`/`cmd`, ao carregar a configuração e de novo antes de cada pedido. O legado usa GET
  para ações (gerar pedido da NF-e, enviar boleto, consultar NF-e na SEFAZ), por isso a guarda vem
  antes de tudo.
- **Exceção só com motivo escrito:** `reviewedReadOnly: { words, reason }`, quando um filtro de leitura
  tem nome de ação (ex.: `canceladas=N`).
- **Só GET**, um pedido por vez, com pausa (`delayMs`), para não pesar no sistema.
- **O único POST é o login**, num endereço fixo da configuração. Usuário e senha vêm de
  `LEGADO_USUARIO`/`LEGADO_SENHA` (ambiente), nunca de arquivo.

## Uso

```bash
cp tools/legacy-extract/legado.config.example.json tools/legacy-extract/legado.config.json   # fora do git
node tools/legacy-extract/extract.mjs login --config tools/legacy-extract/legado.config.json        # navegador: você entra
LEGADO_USUARIO=... LEGADO_SENHA=... node tools/legacy-extract/extract.mjs login-auto --config ...   # servidor, sem navegador
node tools/legacy-extract/extract.mjs run --config tools/legacy-extract/legado.config.json [--only pedidos,cotacoes]
node tools/legacy-extract/extract.mjs status --config tools/legacy-extract/legado.config.json
```

- **Retomável:** o que já foi baixado não baixa de novo. Páginas vazias são conferidas de novo a cada
  rodada, porque o legado pode ganhar registros durante a contingência.
- **Sessão expirou?** Com `LEGADO_USUARIO`/`LEGADO_SENHA` no ambiente, entra de novo sozinho, uma vez.
  Sem isso, para e pede o `login`.
- **Saída** em `outDir`, fora do git porque contém dado pessoal: um arquivo por mês/página/id, mais o
  `manifest.jsonl` com o sha256 de cada arquivo.
- **Montar a lista de caminhos:** `har-to-config.mjs captura.har` gera um rascunho a partir de uma
  navegação gravada (DevTools → Network → Save all as HAR), já sem os caminhos de ação. Revise cada job.

## Depois de baixar: carregar no TSM

Um comando carrega todos os jobs, com a chave de cada um (`archiveKey`, pode ser composta) e sem a
linha de totais (`metaKey`):

```bash
DATABASE_URL=... node tools/legacy-extract/load.mjs --config tools/legacy-extract/legado.config.json
```

Se num mesmo arquivo a chave se repetir com conteúdo diferente, o importador **recusa** em vez de
perder linha. Exemplo real: um cliente com várias unidades usa `codigo+documento`, e uma viagem com
vários MDF-e usa `numero+manifesto`. As respostas do legado vêm em ISO-8859-1. O extrator guarda os
bytes originais (o sha256 vale como evidência) e o importador converte.

Ou job a job:

```bash
node server/dist/scripts/importLegacyArchive.js pedidos  research/legado/extract/pedidos
node server/dist/scripts/importLegacyArchive.js cotacoes research/legado/extract/cotacoes
node server/dist/scripts/importLegacyArchive.js financeiro_receitas research/legado/extract/financeiro_receitas --key codigo
node server/dist/scripts/importExternalFiscal.js research/legado/xml               # XML de CT-e/MDF-e
node server/dist/scripts/importLegacyMasterData.js persons pessoas.csv --dry-run    # cadastros vivos
```

**XML de CT-e:** o job de download em lote por emitente e mês (`split.months` + `forEachId` vindo do
job de empresas) baixa um `.zip` por emitente/mês. Extraia os zips e carregue com
`importExternalFiscal.js` (documentos e eventos de cancelamento). Emitente sem movimento no mês volta
com zip vazio.

O histórico fica em **Gestão → Sistema → Histórico do legado**, pesquisável depois que a assinatura
acabar.

## Testes

```bash
node --test tools/legacy-extract/extract.test.mjs
```
