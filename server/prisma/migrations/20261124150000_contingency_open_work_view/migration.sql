-- Pacote de contingência: tudo que está em aberto na operação, numa linha por pedido.
-- Se o TSM cair, a operação reabre no sistema legado a partir deste CSV (o serviço de backup exporta
-- a cada hora para fora do servidor; a torre baixa o mesmo conteúdo em /api/fiscal/contingency).
-- Só leitura; nenhuma regra de negócio mora aqui.
CREATE OR REPLACE VIEW "contingency_open_work" AS
SELECT
    d."orderNumber"                                   AS pedido,
    o.status::text                                    AS situacao,
    h.code                                            AS hub_atual,
    rem."legalName"                                   AS remetente,
    rem.document                                      AS remetente_doc,
    dst."legalName"                                   AS destinatario,
    dst.document                                      AS destinatario_doc,
    COALESCE(dst.city || '/' || dst.state, o."fimPrestacao", d.destination) AS destino,
    d.weight                                          AS peso_kg,
    d."nfValue"                                       AS valor_nf,
    (SELECT string_agg(COALESCE(oi."nfKey", oi."nfNumber"), ' ' ORDER BY oi."nfNumber")
       FROM "OrderInvoice" oi WHERE oi."orderId" = o.id)                        AS notas_fiscais,
    (SELECT string_agg(
                fc."documentType"::text || ' ' || fc.status::text
                || COALESCE(' ' || fc."cteSeries"::text || '-' || fc."cteNumber", '')
                || COALESCE(' minuta ' || fc."minutaNumber", '')
                || COALESCE(' chave ' || fc."cteAccessKey", ''),
                ' | ' ORDER BY fc."createdAt")
       FROM "OrderFreightCalculation" fc
      WHERE fc."orderId" = o.id AND fc.status::text NOT IN ('DRAFT', 'CTE_CANCELLED', 'DCE_CANCELLED')) AS documentos_frete,
    m.id                                              AS viagem_id,
    m."tripType"::text                                AS viagem_tipo,
    m.status::text                                    AS viagem_situacao,
    mh.code                                           AS viagem_origem,
    mdh.code                                          AS viagem_destino,
    lk.name                                           AS transportador,
    (SELECT string_agg(vu.plate, ' ' ORDER BY mva.slot)
       FROM "ManifestVehicleAssignment" mva JOIN "VehicleUnit" vu ON vu.id = mva."vehicleUnitId"
      WHERE mva."manifestId" = m.id)                                             AS placas,
    (SELECT string_agg(mfd."documentType"::text || COALESCE(' ' || mfd."accessKey", ''), ' | ')
       FROM "ManifestFiscalDocument" mfd
      WHERE mfd."manifestId" = m.id AND mfd."cancelledAt" IS NULL)               AS documentos_viagem,
    o."enteredAtHubAt"                                AS entrou_no_hub_em,
    o."updatedAt"                                     AS atualizado_em
FROM "Order" o
JOIN "Demand" d ON d.id = o."demandId"
LEFT JOIN "Hub" h ON h.id = o."currentHubId"
LEFT JOIN "Person" rem ON rem.id = o."remetentePersonId"
LEFT JOIN "Person" dst ON dst.id = o."destinatarioPersonId"
LEFT JOIN LATERAL (
    SELECT l."manifestId"
      FROM "OrderLeg" l
      JOIN "Manifest" lm ON lm.id = l."manifestId"
     WHERE l."orderId" = o.id AND l."completedAt" IS NULL AND lm.status::text NOT IN ('COMPLETED', 'CANCELLED')
     ORDER BY l.sequence DESC
     LIMIT 1
) leg ON TRUE
LEFT JOIN "Manifest" m ON m.id = leg."manifestId"
LEFT JOIN "Hub" mh ON mh.id = m."hubId"
LEFT JOIN "Hub" mdh ON mdh.id = m."destHubId"
LEFT JOIN "Link" lk ON lk.id = m."linkId"
WHERE o.status::text NOT IN ('DELIVERED', 'CANCELLED');
