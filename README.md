# Mobilidade

Plataforma de mobilidade urbana conectando passageiros e motoristas. Este repositório contém o início do backend e da estrutura para os aplicativos móveis e painel administrativo.

> **Status:** desenvolvimento inicial. Não está pronto para uso em produção.

## Implementado

- API Fastify + TypeScript.
- Cadastro de passageiro e motorista.
- Login com e-mail e senha.
- Hash de senhas com bcrypt.
- Tokens JWT com expiração de uma hora.
- Consulta e atualização de perfil autenticado.
- Campos iniciais para perfil do motorista e veículo.
- PostgreSQL + Prisma para persistência.
- Limitação de requisições nas rotas de autenticação.
- Workflow de CI para validação automatizada.\n- Geocodificação de endereços e cálculo de rotas de carro via OpenStreetMap Nominatim + OSRM.\n- Estimativa inicial de preço por distância e duração, com valores configuráveis.

## Rodar localmente

Requisitos: Node.js 20+ e Docker.

```bash
docker compose up -d postgres
cp .env.example .env
```

Edite `.env` e configure `JWT_SECRET` com um segredo aleatório de pelo menos 32 caracteres (por exemplo, gere com `openssl rand -base64 48`). Depois:

```bash
npm install
npm run db:generate
npm run db:push
npm run dev:api
```

A API ficará disponível em `http://localhost:3333`. Teste `GET /health`.

## Endpoints de autenticação

| Método | Endpoint | Descrição |
|---|---|---|
| POST | `/auth/register` | Cadastro de passageiro ou motorista |
| POST | `/auth/login` | Login e emissão de JWT |
| GET | `/me` | Consultar perfil autenticado |
| PATCH | `/me` | Atualizar nome e telefone |
| PATCH | `/profiles/driver` | Atualizar dados do motorista e veículo |

Para rotas protegidas, envie `Authorization: Bearer <token>`.

Documentação detalhada: [API](apps/api/README.md) · [Autenticação](docs/authentication.md) · [Arquitetura](docs/architecture.md).

## Aplicativos móveis

- Passageiro: `npm run dev:passenger`
- Motorista: `npm run dev:driver`

Configure `EXPO_PUBLIC_API_URL` para o endereço da API acessível pelo dispositivo. No emulador Android use `http://10.0.2.2:3333`; em aparelho físico use o IP local do computador na rede Wi-Fi. Veja os detalhes em [app do passageiro](apps/passenger/README.md) e [app do motorista](apps/driver/README.md).

## Próximas etapas

- Verificação de e-mail e telefone, recuperação de senha e refresh tokens.
- Fluxo administrativo de aprovação de motoristas.
- Aplicativos móveis reais para passageiro e motorista.
- Mapas nativos integrados, despacho de corridas e localização em tempo real.\n- Validar e ajustar a política comercial de tarifas antes de produção.
- Testes automatizados, migrações versionadas, monitoramento e revisão de segurança/LGPD.
