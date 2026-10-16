# VIAÊ — Exemplos de requisição e resposta

Todos os dados de pessoa, IDs, datas, valores e placas deste documento são fictícios. Os endpoints de corrida, cotação e mapas são contratos planejados, não funcionalidades atualmente implantadas.

## 1. Cadastro existente

`POST /auth/register`

```json
{
  "name": "Maria Silva",
  "email": "maria@example.com",
  "phone": "+5551999999999",
  "password": "senha-forte-de-exemplo",
  "role": "passenger"
}
```

O papel público aceita `passenger` ou `driver`; cadastro administrativo não é público.

## 2. Login existente

`POST /auth/login`

```json
{
  "email": "maria@example.com",
  "password": "senha-forte-de-exemplo"
}
```

A resposta atual inclui `token`, `tokenType` e `user`. O JWT atualmente expira em uma hora. Refresh token não está implementado no contrato atual.

## 3. Estimar rota — planejado

`POST /v1/routes/estimate`

```json
{
  "origin": { "latitude": -30.0346, "longitude": -51.2177 },
  "destination": { "latitude": -30.0619, "longitude": -51.1735 },
  "waypoints": []
}
```

Resposta ilustrativa:

```json
{
  "data": {
    "distanceMeters": 6200,
    "durationSeconds": 1200,
    "encodedPolyline": "polyline-de-exemplo"
  }
}
```

Distância e duração devem vir da integração de mapas no backend. A polyline acima não representa uma rota real.

## 4. Gerar cotação — planejado

`POST /v1/quotes`

```json
{
  "origin": { "latitude": -30.0346, "longitude": -51.2177 },
  "destination": { "latitude": -30.0619, "longitude": -51.1735 },
  "category": "standard",
  "waypoints": []
}
```

Resposta ilustrativa:

```json
{
  "data": {
    "quoteId": "00000000-0000-4000-8000-000000000002",
    "currency": "BRL",
    "estimatedDistanceMeters": 6200,
    "estimatedDurationSeconds": 1200,
    "estimatedFareCents": 2450,
    "expiresAt": "2026-10-16T20:15:00Z"
  }
}
```

O valor de R$ 24,50 é um exemplo inventado para demonstrar o formato, não uma tarifa real da VIAÊ. O backend deve aplicar regra tarifária versionada e expiração da cotação.

## 5. Solicitar corrida — planejado

`POST /v1/trips`

Cabeçalhos:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Idempotency-Key: 2cc44c55-0f8a-4f80-a27a-74f1f9d50120
```

```json
{
  "quoteId": "00000000-0000-4000-8000-000000000002",
  "paymentMethodId": "pm_example",
  "notes": "Aguardar na entrada principal"
}
```

Resposta `201 Created` ilustrativa:

```json
{
  "data": {
    "tripId": "00000000-0000-4000-8000-000000000001",
    "status": "searching",
    "estimatedFareCents": 2450,
    "currency": "BRL",
    "createdAt": "2026-10-16T20:00:00Z"
  }
}
```

A mesma chave e o mesmo corpo devem devolver o resultado original. Reutilizar a chave com corpo diferente deve retornar conflito.

## 6. Erro padronizado proposto

```json
{
  "error": {
    "code": "INVALID_TRIP_STATE",
    "message": "Esta operação não é permitida no estado atual da corrida.",
    "details": { "currentStatus": "completed" }
  },
  "meta": { "requestId": "req_example" }
}
```

A API atual pode retornar formatos de erro diferentes em algumas rotas. A padronização deverá ser implementada e validada por testes de contrato.

## Moeda, tempo e IDs

- Valores monetários em centavos inteiros (ex.: `2450` = R$ 24,50).
- Datas ISO 8601 em UTC.
- Coordenadas em graus decimais WGS84.
- IDs das entidades persistidas como CUID no schema Prisma atual.
- Não registrar tokens, senhas, CPF, CNH ou dados de cartão nos logs.


## Estado real do primeiro fluxo MVP

- Implementados nesta branch: `POST /api/v1/quotes`, `POST /api/v1/trips` e `GET /api/v1/trips/{tripId}`.
- A cotação usa distância geodésica com fator de estrada configurável; não chama Google Maps ainda e não deve ser tratada como rota real.
- A solicitação persiste no PostgreSQL, reserva a cotação uma única vez e exige `Idempotency-Key`.
- Despacho automático, aceitação de ofertas e pagamento continuam pendentes.
- IDs usam CUID conforme o schema Prisma atual.
