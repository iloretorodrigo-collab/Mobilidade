# Configuração do Google Maps Platform

A integração é executada pelo backend. Nunca inclua a chave do Google Maps nos aplicativos móveis, no repositório ou em logs.

## Configuração no Google Cloud

1. Selecione ou crie um projeto no Google Cloud Console.
2. Ative o faturamento para o projeto.
3. Ative **Routes API** e **Places API (New)**.
4. Crie uma API key exclusiva para o backend.
5. Restrinja a chave às APIs Routes API e Places API (New). Em produção, aplique também restrições de IP compatíveis com a hospedagem da API.
6. Configure alertas de orçamento e quotas para detectar uso inesperado.

## Configuração da API

No ambiente onde a API Fastify roda, configure:

```env
GOOGLE_MAPS_API_KEY=sua_chave_real
```

Para desenvolvimento local, coloque a variável no arquivo `.env` local (que não deve ser commitado) e reinicie a API. Em produção, use o gerenciador de segredos da hospedagem. Não envie essa variável para o Expo nem para os apps de passageiro/motorista.

## Endpoints integrados

- `GET /api/v1/places/autocomplete?input=...` — sugestões de endereços; aceita coordenadas opcionais para localização de contexto.
- `POST /api/v1/routes/estimate` — distância, duração e polyline da rota real.
- `POST /api/v1/quotes` — usa Routes API para estimar distância/duração e calcular a cotação quando a chave está configurada.

Sem a chave, cotação sem paradas pode usar a aproximação MVP, explicitamente identificada como `mvp_straight_line_approximation`. Rota com paradas e endpoints de Maps retornam indisponibilidade em vez de inventar uma rota.

## Verificação pós-configuração

1. Confirme que a API iniciou sem erro de credenciais.
2. Teste autocomplete com uma consulta de endereço real.
3. Teste `/api/v1/routes/estimate` com coordenadas conhecidas em Porto Alegre.
4. Compare distância/duração com o Google Maps e verifique a polyline em um mapa cliente.
5. Confira métricas, quotas, custos e restrições de chave antes de liberar para usuários reais.

O CI valida contrato, build e fluxo de integração sem exigir uma chave real. A validação do provedor Google precisa ser feita em ambiente com chave e faturamento configurados.