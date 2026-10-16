# VIAÊ — Máquina de estados da corrida

**Status:** contrato de domínio proposto. Deve ser implementado e testado no backend antes de habilitar corridas reais.

## Estados

- `requested`: solicitação registrada e validada.
- `searching`: despacho procurando motoristas elegíveis.
- `accepted`: motorista atribuído.
- `driver_arrived`: motorista informou chegada ao embarque.
- `in_progress`: corrida iniciada.
- `completed`: corrida finalizada.
- `canceled`: corrida cancelada sob as regras aplicáveis.

## Transições permitidas

| Estado atual | Próximo estado | Ator | Condições |
|---|---|---|---|
| requested | searching | sistema | Cotação válida, área atendida e solicitação persistida |
| requested | canceled | passageiro/sistema | Cancelamento permitido |
| searching | accepted | sistema/atribuição | Oferta válida e atribuição atômica |
| searching | canceled | passageiro/sistema | Busca cancelada; invalidar ofertas abertas |
| accepted | driver_arrived | motorista atribuído | Motorista e corrida conferidos no servidor |
| accepted | canceled | passageiro/motorista/suporte | Política de cancelamento aplicada |
| driver_arrived | in_progress | motorista atribuído | Início permitido e registrado |
| driver_arrived | canceled | atores autorizados | Política de cancelamento aplicada |
| in_progress | completed | motorista atribuído/sistema autorizado | Finalização validada; tarifa final e pagamento processados conforme política |

Qualquer transição não listada deve ser rejeitada com HTTP 409 e código `INVALID_TRIP_STATE`. Corridas terminais (`completed`, `canceled`) não reabrem por alteração comum; correções administrativas exigem operação separada e auditada.

## Invariantes

1. Uma única atribuição ativa por corrida.
2. Apenas passageiro proprietário, motorista atribuído ou operador com permissão acessam dados da corrida.
3. Atribuição de motorista é atômica no PostgreSQL (transação/índice ou bloqueio apropriado).
4. Operações de mutação aceitam idempotência; repetição não duplica corrida, evento ou cobrança.
5. Cada transição gera evento persistido com ator, estado anterior/novo, timestamp e versão monotônica.
6. O evento publicado não pode preceder a confirmação durável da transação; usar transactional outbox.
7. Tarifas usam centavos inteiros em BRL e snapshot/versionamento da regra aplicada.
8. Estado de pagamento é separado do estado da corrida; não inferir pagamento confirmado apenas por corrida concluída.
9. Falhas de rede não autorizam o cliente a presumir sucesso; consultar o estado por REST.
10. Cancelamentos e incidentes relevantes mantêm trilha de auditoria sem expor dados pessoais em logs gerais.

## Códigos de erro de domínio

- `INVALID_TRIP_STATE`: transição inválida.
- `TRIP_ALREADY_ASSIGNED`: outro motorista venceu a atribuição.
- `OFFER_EXPIRED`: oferta expirou.
- `QUOTE_EXPIRED`: cotação expirou.
- `OUTSIDE_SERVICE_AREA`: origem/destino fora da área atendida.
- `IDEMPOTENCY_CONFLICT`: mesma chave usada com payload diferente.

## Concorrência e retries

A aceitação de ofertas deve ser executada dentro de uma transação serializável ou por atualização condicional que garanta que apenas um motorista consiga mudar a corrida de `searching` para `accepted`. Retentativas devem reutilizar a mesma chave de idempotência. Criar testes concorrentes para pelo menos dois motoristas tentando aceitar a mesma corrida.
