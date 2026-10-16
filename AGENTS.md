# Orientações para agentes de desenvolvimento

Este projeto é o Monitor Agrícola (`marcosjpaps/monitor_produt`). O painel principal deve permanecer no padrão visual do Drone, sem criar uma segunda experiência de navegação. Preservar o login, os parsers agrícolas, o PostgreSQL/Neon, os arquivos importados e a integridade das geometrias.

## Identidade Git obrigatória antes de cada commit

Ao trabalhar em uma cópia deste repositório, execute:

```sh
sh scripts/configurar-identidade-git.sh
git config --local --get user.name
git config --local --get user.email
```

Este script configura apenas a cópia local do repositório para `marcosjpaps` e o endereço GitHub `81382988+marcosjpaps@users.noreply.github.com`; não depende de e-mail pessoal. **Não criar commits com `codex-agent@localhost` ou outros e-mails `@localhost`.** Não sobrescrever identidade global do computador. Se estiver operando em outro fork ou em nome de outro colaborador, interromper e solicitar ao proprietário autorização da identidade correta.

Se usar a API de conteúdos do GitHub em vez do `git commit` local, conferir que o commit foi associado à conta autenticada antes do deploy. Uma configuração versionada não altera automaticamente o `.git/config` de outros ambientes: execute o script em **cada novo clone ou ambiente de agente**.

## Publicação e testes

- Enviar alterações para branch separada e PR. Não mesclar, promover ou gravar na produção do Neon apenas porque a compilação Vercel foi concluída.
- Antes de liberar importações agrícolas, testar os cinco ZIPs registrados em `DIAGNOSTICO_IMPORTACOES_REAIS.md` com banco de testes; arquivos AGF proprietários/criptografados não devem ser anunciados como telemetria decodificada.
- A Central deve rejeitar com explicação clara os arquivos incompletos, e nunca inventar coordenadas, taxa aplicada ou área.
- Não imprimir credenciais, tokens, strings de conexão ou endereços de e-mail pessoais nos logs.
