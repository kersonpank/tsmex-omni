# Providers de preço da viagem

## Propósito

A prévia de custo da viagem separa:

- **receita comercial**: valores dos `OrderFreightCalculation` cobrados aos clientes;
- **custo do Link**: `ManifestFreightAgreement` ou `LinkPricingAgreement`;
- **pedágio real da rota**: provider externo;
- **piso mínimo ANTT**: cálculo por tabela oficial versionada.

Nenhum provider pode sobrescrever automaticamente a Carta Frete negociada.

## Rota e pedágio

Adapter previsto: Google Routes API.

Variável de runtime, somente API/Worker:

```dotenv
GOOGLE_MAPS_API_KEY=""
```

Contrato de saída interno:

```ts
{
  distanceKm: number,
  tollAmount: number,
  currency: 'BRL',
  provider: 'GOOGLE_ROUTES',
  calculatedAt: string,
}
```

A chamada deve considerar origem/destino canônicos do Manifesto, composição/eixos quando o provider suportar e rota sem `avoidTolls`. Ausência de chave ou de cobertura retorna `null`; nunca `0` como se fosse pedágio confirmado.

## Piso mínimo ANTT

Não existe provider ANTT configurado no TSM. A implementação deve usar uma tabela versionada no banco, com:

```text
source
legal reference
publishedAt
effectiveFrom
effectiveTo
vehicle/composition category
number of axles
distance range
coefficient/value
```

O cálculo retorna o piso e a versão da tabela. Quando a Carta Frete estiver abaixo, a UI alerta e oferece aplicar o piso; o valor negociado não é alterado silenciosamente.

## Integração com CIOT Fracionado

A Carta Frete é o total da operação paga ao Link. Quando houver vários CT-es/pedidos, a próxima fatia distribuirá componentes por `Viagens`:

```text
frete bruto
pedágio
adiantamento
quitação
combustível
seguro
```

A regra de distribuição deve ser auditável e confirmada pelo operador antes da emissão; não ratear componentes indisponíveis.
