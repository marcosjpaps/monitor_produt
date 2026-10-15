# Segurança e publicação do Monitor Agrícola

## Situação em 15/10/2026

Este repositório foi publicado anteriormente com senha de acesso no JavaScript do portal e credenciais PostgreSQL em arquivos versionados. **Eliminar essas strings dos arquivos atuais não revoga credenciais vazadas e não apaga o histórico do Git.** A implantação segura exige revogação das credenciais comprometidas e armazenamento exclusivo nas variáveis de ambiente protegidas.

Este ramo de segurança implementa autenticação server-side e remove os valores do código. **Não mescle nem publique sem configurar as variáveis de ambiente e validar o login.** Não modifique dados agrícolas durante a implantação.

## Configuração da Vercel

A integração `agrotelemetry-monitor` identificada em 15/10/2026 aponta para `marcosjpaps/drone`, não `marcosjpaps/monitor_produt`. Corrija a integração Git desse projeto ou crie um novo projeto Vercel **vinculado a `marcosjpaps/monitor_produt`** antes de promover esta versão. Não mova domínios até confirmar a execução da nova versão.

Em Project Settings → Environment Variables, crie valores **Sensitive/Encrypted** nas categorias Production, Preview e Development conforme necessário:

- `DATABASE_URL`: conexão PostgreSQL de produção (de preferência nova credencial criada após revogação da antiga).
- `POSTGRES_URL`: alias opcional para integrações antigas; pode apontar para a mesma conexão.
- `APP_ADMIN_EMAIL`: e-mail de acesso ao portal.
- `APP_ADMIN_PASSWORD`: senha válida de acesso; não pode ficar no HTML nem no Git.
- `APP_SECRET_KEY`: segredo independente aleatório, com **pelo menos 32 caracteres**, usado para assinar sessões. Não use a senha do usuário nem a do banco.
- `APP_ENV=production`: habilita cookies de sessão Secure.

As credenciais antigas foram expostas no Git, portanto recomenda-se **rotacionar a senha do banco no painel Neon**, atualizar a Vercel e só então revogar o acesso antigo. Alterar a senha do banco exige verificar outros sistemas que compartilham o mesmo usuário do Neon. Não remova bancos, tabelas nem registros. A antiga senha do login também era pública: mantenha o mesmo e-mail e configure uma nova senha privada quando possível.

## Testes mínimos antes de ir ao ar

1. Acessar `/api/health` e validar `status: ok`.
2. Acessar `/api/dashboard/kpis` sem estar autenticado: deve responder HTTP 401.
3. Acessar `/api/talhoes` sem sessão: deve responder HTTP 401.
4. Entrar pelo portal `/` com a senha configurada na Vercel e validar o cookie HttpOnly; verificar `/api/auth/me`.
5. Acessar John Deere, Jacto e Massey após login; conferir importação de arquivos reais, filtros, tabelas, métricas, mapas e detalhes.
6. Sair e comprovar que as APIs voltam a responder 401.
7. Testar arquivos inválidos, importação duplicada, exclusão/restauração **apenas com dados de teste**.
8. Conferir o domínio, o repositório vinculado e o SHA implantado na Vercel.
9. Revisar o histórico do Git e regras de segredo; mudar credenciais antigas é indispensável.

## Limites

- A verificação de origem e SameSite minimiza requisições indevidas do navegador, mas não substitui defesa contra XSS.
- O bloqueio de tentativas de login usa memória de cada instância e não é um rate limiter distribuído; produção deve usar regras de WAF/Firewall na Vercel.
- As páginas estáticas dos cockpits podem ser baixadas sem sessão; **as APIs e os dados estão protegidos no servidor**. Para impedir acesso ao HTML em si, use Deployment Protection ou middleware de borda.
- O endpoint de saúde atesta apenas a resposta da API, não necessariamente conectividade de todas as fontes de dados.
- Os cálculos agronômicos dependem dos dados efetivamente presentes nos arquivos; não trate estimativas como medições do monitor.
