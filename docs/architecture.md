# Arquitetura inicial

- `apps/passenger`: app móvel para passageiros (planejado).
- `apps/driver`: app móvel para motoristas (planejado).
- `apps/admin`: painel operacional web (planejado).
- `apps/api`: API HTTP em Fastify e TypeScript.
- `packages/shared`: tipos compartilhados do domínio.
- `packages/database`: schema Prisma/PostgreSQL.
- `docker-compose.yml`: banco local de desenvolvimento.

## Próximas etapas
1. Implementar autenticação e verificação de telefone.
2. Criar fluxo de solicitação, despacho e atualização de corridas.
3. Integrar mapas/geocodificação e cálculo de rota.
4. Adicionar localização em tempo real, notificações e pagamentos.
5. Criar testes, observabilidade, proteção antifraude e revisão de segurança.

Esta estrutura é um ponto de partida, não um sistema de transporte pronto para produção.
