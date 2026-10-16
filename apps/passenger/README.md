# App do passageiro

Aplicativo React Native + Expo com telas de cadastro, login e perfil conectadas à API.

## Configuração

1. Instale dependências na raiz: `npm install`.
2. Configure a API com PostgreSQL, `.env` e `JWT_SECRET` seguindo [o guia da API](../api/README.md).
3. Defina `EXPO_PUBLIC_API_URL` antes de iniciar o Expo. Exemplos:
   - iOS Simulator: `http://localhost:3333`
   - Android Emulator: `http://10.0.2.2:3333`
   - Celular físico: `http://IP_LOCAL_DO_SEU_COMPUTADOR:3333` (mesma rede Wi-Fi).
4. Inicie na raiz: `npm run dev:passenger`.

A API precisa estar acessível pelo dispositivo. O token é armazenado com Expo SecureStore. A área autenticada permite informar origem e destino, calcular rota rodoviária e estimar o preço. O mapa interativo usa Leaflet com tiles do OpenStreetMap dentro do app; o botão também abre a rota no OpenStreetMap. Geocodificação e roteamento dependem dos serviços públicos Nominatim/OSRM. A estimativa não solicita nem despacha uma corrida, e tarifas/pagamentos comerciais ainda não foram implementados.
