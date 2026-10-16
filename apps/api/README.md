# API

API HTTP inicial em Fastify/TypeScript, com autenticação JWT, hashing de senhas e perfis persistidos em PostgreSQL via Prisma.

## Requisitos
- Node.js 20+
- Docker (para o PostgreSQL local)
- npm

## Inicialização local

Na raiz do repositório:

```bash
docker compose up -d postgres
cp .env.example .env
```

Edite o arquivo `.env` e defina um `JWT_SECRET` aleatório com pelo menos 32 caracteres. Você pode gerar um com `openssl rand -base64 48`.

Depois execute:

```bash
npm install
npm run db:generate
npm run db:push
npm run dev:api
```

A API inicia em `http://localhost:3333`.

## Endpoints

- `GET /health` — status da API.
- `GET /mobility/geocode?query=...` — localiza um endereço usando OpenStreetMap Nominatim.
- `POST /mobility/estimate` — calcula rota de carro, distância, duração aproximada e preço estimado.
- `POST /auth/register` — cria conta de passageiro ou motorista.
- `POST /auth/login` — autentica por e-mail e senha.
- `GET /me` — consulta o perfil autenticado.
- `PATCH /me` — atualiza nome e/ou telefone.
- `PATCH /profiles/driver` — atualiza dados do veículo e informações de verificação do motorista.
- `POST /auth/password/forgot` e `POST /auth/password/reset` — recuperação de senha por código enviado ao e-mail.
- `POST /auth/verification/email` e `POST /auth/verification/phone` — solicita código para verificar os contatos do usuário autenticado.
- `POST /auth/verification/confirm` — confirma código de e-mail ou telefone.
- `GET /admin/drivers/pending` — lista motoristas aguardando análise administrativa.
- `PATCH /admin/drivers/:userId/approval` — aprova ou rejeita um motorista; somente administradores.

Endpoints protegidos exigem o cabeçalho `Authorization: Bearer <token>`. O token expira em uma hora; faça login novamente para obter outro.

## Cadastro de passageiro

```http
POST /auth/register
Content-Type: application/json
```

```json
{
  "name": "Maria Silva",
  "email": "maria@example.com",
  "phone": "+5551999999999",
  "password": "uma-senha-forte",
  "role": "passenger"
}
```

Para motoristas, use `"role": "driver"`. O perfil do motorista começa com status de aprovação `pending` e não está autorizado a operar até que um processo administrativo de verificação seja implementado.

## Login

```json
{
  "email": "maria@example.com",
  "password": "uma-senha-forte"
}
```

O cadastro e o login retornam `token`, `tokenType` e `user`. Nunca compartilhe ou registre tokens em logs públicos.

## Observações de segurança

- Senhas são armazenadas com hash bcrypt; a senha original nunca é devolvida.
- O cadastro público aceita somente os papéis `passenger` e `driver`; não é possível se registrar como administrador.
- As rotas de cadastro/login têm limite de tentativas.
- CPF e número de CNH são armazenados no banco, mas não são devolvidos nos dados públicos de perfil.
- Configure HTTPS, política de privacidade, verificação de telefone/e-mail, recuperação de senha, refresh tokens, monitoramento e revisão de segurança antes de produção.

## Verificação de contato e recuperação de senha

Os códigos expiram em 10 minutos e aceitam no máximo cinco tentativas. Em desenvolvimento, os códigos são registrados no log da API e retornados como `developmentCode` para facilitar testes locais. **Esse comportamento não existe em produção.**

Para e-mail, configure `RESEND_API_KEY` e `EMAIL_FROM`. Para SMS, configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_FROM`. Em produção, a API falha de forma explícita quando o provedor correspondente não está configurado. Use HTTPS e segredos reais fora do repositório.

## Administração e aprovação de motoristas

O cadastro público não permite criar contas ADMIN. Para configurar o primeiro administrador localmente, defina `ADMIN_EMAIL` e `ADMIN_PASSWORD` e execute:

```bash
npm run db:seed-admin
```

O script promove/cria apenas o e-mail explicitamente configurado como administrador. Não exponha essas credenciais. Em produção, rode o comando por um processo operacional protegido e use uma senha forte.

A listagem administrativa retorna dados pessoais e documentais; proteja o acesso, registre auditoria das decisões e aplique as regras de retenção de dados antes de lançar publicamente.

## Testes de integração

Com PostgreSQL e API configurados:

```bash
npm run db:generate
npm run db:push
npm run db:seed-admin
npm run dev:api
# Em outro terminal
npm run test:integration
```

O workflow GitHub Actions executa typecheck da API e dos dois aplicativos, build da API e testes de integração contra PostgreSQL descartável. O workflow ainda precisa concluir uma execução verde para que os testes sejam considerados aprovados.


## Mapas, rotas e estimativa de tarifa

O endpoint `POST /mobility/estimate` recebe endereços textuais de origem e destino:

```json
{ "origin": "Praça da Sé, São Paulo - SP", "destination": "Avenida Paulista, São Paulo - SP" }
```

A resposta inclui os pontos geocodificados, distância em km, tempo estimado em minutos, tarifa em centavos e reais, URL para abrir a rota no OpenStreetMap e atribuição dos provedores. Geocodificação usa OpenStreetMap Nominatim e rotas rodoviárias usam OSRM público; esses serviços externos podem ter limites, indisponibilidade e cobertura variável. A chamada aguarda entre as consultas de endereço para respeitar a política de uso do Nominatim.

Tarifa inicial configurável por ambiente (valores em centavos): `MOBILIDADE_FARE_BASE_CENTS=500`, `MOBILIDADE_FARE_PER_KM_CENTS=220`, `MOBILIDADE_FARE_PER_MINUTE_CENTS=35` e `MOBILIDADE_FARE_MINIMUM_CENTS=800`. Fórmula: maior entre o mínimo e a soma de tarifa base + distância × tarifa/km + duração × tarifa/minuto. Esses valores são parâmetros de demonstração, não uma tarifa comercial validada. A estimativa não é cotação garantida e ainda não cria nem despacha uma corrida.
