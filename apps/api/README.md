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
- `POST /auth/register` — cria conta de passageiro ou motorista.
- `POST /auth/login` — autentica por e-mail e senha.
- `GET /me` — consulta o perfil autenticado.
- `PATCH /me` — atualiza nome e/ou telefone.
- `PATCH /profiles/driver` — atualiza dados do veículo e informações de verificação do motorista.

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
