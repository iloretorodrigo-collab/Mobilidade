# VIAÊ — Contratos WebSocket

**Status:** Socket.IO foi integrado ao servidor para autenticação JWT, inscrição autorizada em sala de corrida, ofertas de motorista e atualização de localização. Mensagens, alertas de segurança, ETA e outbox ainda são planejados. Os exemplos usam dados fictícios.

## Transporte e autenticação

- Transporte proposto: Socket.IO sobre HTTPS/WSS.
- Endpoint: `/realtime/socket.io` no mesmo host da API.
- O cliente apresenta JWT válido no handshake. Nunca enviar tokens em query strings.
- O servidor identifica o usuário, papel, aprovação do motorista e permissões antes de permitir inscrições em salas.
- Salas privadas: `trip:{tripId}`; uma sala de ofertas por motorista autenticado; salas operacionais segmentadas por área somente para motoristas elegíveis.
- Cada evento de domínio enviado pelo servidor contém `eventId`, `occurredAt` e `data`. Clientes devem tolerar duplicatas e eventos fora de ordem.

## Envelope padrão do servidor

```json
{
  "event": "trip.status_changed",
  "eventId": "evt_01JEXAMPLE",
  "occurredAt": "2026-10-16T20:02:00Z",
  "data": {
    "tripId": "00000000-0000-4000-8000-000000000001",
    "status": "accepted",
    "version": 3
  }
}
```

## Eventos cliente → servidor

| Evento | Payload | Autorização e validação |
|---|---|---|
| `trip.subscribe` | `{ "tripId": "UUID" }` | Usuário deve ser passageiro da corrida, motorista atribuído ou operador autorizado. |
| `trip.unsubscribe` | `{ "tripId": "UUID" }` | Remover somente a própria conexão da sala. |
| `driver.location_update` | latitude, longitude, headingDegrees?, recordedAt | Motorista aprovado; coordenadas válidas; limite de frequência; aceitar apenas timestamps razoáveis. |
| `trip.typing` | `{ "tripId": "UUID", "isTyping": true }` | Participante autorizado da conversa; evento efêmero, com rate limit. |

Aceitar, cancelar, iniciar ou finalizar corrida e movimentar dinheiro são operações REST transacionais. Eventos WebSocket não devem executar essas operações diretamente.

## Eventos servidor → cliente

| Evento | Destinatários | Dados essenciais |
|---|---|---|
| `trip.status_changed` | Participantes autorizados | tripId, previousStatus, status, version |
| `trip.driver_assigned` | Passageiro | tripId, driverId, dados públicos do motorista e veículo |
| `trip.driver_location` | Passageiro/motorista da corrida | tripId, latitude, longitude, headingDegrees?, sequence |
| `trip.eta_updated` | Passageiro | tripId, etaSeconds, calculatedAt |
| `driver.offer_created` | Motorista elegível | offerId, tripId, pickupDistanceMeters, expiresAt |
| `driver.offer_expired` | Motorista que recebeu a oferta | offerId, tripId, expiredAt |
| `trip.message_received` | Participantes da conversa | tripId, messageId, senderId, text, createdAt |
| `trip.safety_alert` | Destinatários explicitamente autorizados | incidentId, tripId, severity, createdAt |

## ACKs e erros

O cliente deve solicitar confirmação ao se inscrever e ao enviar localização. Exemplo de ACK de inscrição:

```json
{
  "ok": true,
  "data": {
    "tripId": "00000000-0000-4000-8000-000000000001",
    "subscription": "active"
  }
}
```

Erro padronizado:

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Você não tem acesso a esta corrida."
  }
}
```

Códigos sugeridos: `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_PAYLOAD`, `RATE_LIMITED`, `TRIP_NOT_FOUND`, `STALE_EVENT`.

## Reconexão e consistência

1. Cliente reconecta com backoff exponencial e jitter.
2. Após reconectar, autentica novamente e reinscreve-se nas salas autorizadas.
3. Busca o estado atual via REST (`GET /v1/trips/{tripId}`) antes de aplicar atualizações incrementais.
4. Usa `version` para ignorar estados antigos e `sequence` para descartar posições fora de ordem.
5. Eventos críticos devem ser persistidos no backend e publicados por outbox transacional; não confiar apenas na entrega WebSocket.
6. Localização só é distribuída durante a finalidade operacional autorizada e respeitando retenção e privacidade definidas pela VIAÊ.

## Metas operacionais iniciais

- Reconexão testada em troca de rede e suspensão do app.
- Rate limit para localização e mensagens.
- Métricas de conexões ativas, atraso, falhas de entrega e desconexões.
- Meta de projeto: latência p95 inferior a 1 segundo em ambiente de teste controlado; medir antes de declarar cumprida.
