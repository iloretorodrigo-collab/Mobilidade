# App do motorista

Aplicativo React Native + Expo com telas de cadastro, login e perfil conectadas à API. O formulário inclui dados opcionais do veículo e da habilitação; contas novas começam aguardando aprovação.

## Configuração

1. Instale dependências na raiz: `npm install`.
2. Configure a API com PostgreSQL, `.env` e `JWT_SECRET` seguindo [o guia da API](../api/README.md).
3. Defina `EXPO_PUBLIC_API_URL` antes de iniciar o Expo. Exemplos:
   - iOS Simulator: `http://localhost:3333`
   - Android Emulator: `http://10.0.2.2:3333`
   - Celular físico: `http://IP_LOCAL_DO_SEU_COMPUTADOR:3333` (mesma rede Wi-Fi).
4. Inicie na raiz: `npm run dev:driver`.

A API precisa estar acessível pelo dispositivo. O token é armazenado com Expo SecureStore. A verificação de documentos e o recebimento de corridas ainda não foram implementados.
