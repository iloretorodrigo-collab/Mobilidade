# Cadastro, login e perfis

Base URL local: `http://localhost:3333`.

## 1. Criar conta

`POST /auth/register`

Passageiro:
```json
{
  "name": "Maria Silva",
  "email": "maria@example.com",
  "phone": "+5551999999999",
  "password": "uma-senha-forte",
  "role": "passenger"
}
```

Motorista: use o mesmo formato com `"role": "driver"`. O perfil de motorista é criado com aprovação pendente.

## 2. Entrar

`POST /auth/login`

```json
{
  "email": "maria@example.com",
  "password": "uma-senha-forte"
}
```

Guarde o token de forma segura no cliente e envie-o em chamadas protegidas:

`Authorization: Bearer <token>`

## 3. Consultar e editar perfil

- `GET /me` retorna os dados da conta autenticada.
- `PATCH /me` atualiza nome e/ou telefone. Exemplo: `{"name":"Maria S. Silva"}`.
- `PATCH /profiles/driver` atualiza dados do veículo e dados de verificação; somente motoristas autenticados podem usar essa rota.

Exemplo de dados do motorista:
```json
{
  "vehicleMake": "Toyota",
  "vehicleModel": "Corolla",
  "vehicleColor": "Prata",
  "vehiclePlate": "ABC1D23",
  "cpf": "12345678901",
  "licenseNumber": "00000000000"
}
```

Use somente dados fictícios em testes. Não envie CPF/CNH reais para ambientes de desenvolvimento compartilhados.

## Códigos de resposta comuns

- `201`: conta criada.
- `200`: login ou atualização concluídos.
- `400`: corpo inválido.
- `401`: token ausente/inválido ou credenciais incorretas.
- `403`: rota de motorista chamada por outro tipo de conta.
- `409`: e-mail, telefone ou identificador do motorista já cadastrado.
- `429`: limite de tentativas atingido.

## Limitações atuais

Ainda não há verificação de e-mail/telefone, recuperação de senha, refresh tokens, autenticação multifator, upload seguro de documentos, painel para aprovar motoristas ou migrações SQL versionadas. Antes de produção, implemente esses fluxos e faça uma revisão de segurança e LGPD.
