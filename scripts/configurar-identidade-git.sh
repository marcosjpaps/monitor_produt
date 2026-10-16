#!/bin/sh
# Configura SOMENTE o repositorio atual, sem alterar a identidade Git global.
# Autorize este repositorio em sua conta GitHub antes de fazer commits.
set -eu

root="$(git rev-parse --show-toplevel)"
cd "$root"
remote="$(git remote get-url origin 2>/dev/null || true)"
case "$remote" in
  *github.com[:/]marcosjpaps/monitor_produt|*github.com[:/]marcosjpaps/monitor_produt.git) ;;
  *)
    echo "Repositorio nao identificado como marcosjpaps/monitor_produt; nenhuma configuracao alterada." >&2
    exit 1
    ;;
esac

# Endereco noreply vinculado ao identificador publico da conta marcosjpaps.
# Nao expor e-mail pessoal ou credenciais no codigo.
git config --local user.name "marcosjpaps"
git config --local user.email "81382988+marcosjpaps@users.noreply.github.com"

case "$(git config --local --get user.email)" in
  "81382988+marcosjpaps@users.noreply.github.com")
    echo "Identidade local do Git configurada com o noreply do proprietario."
    ;;
  *)
    echo "Nao foi possivel confirmar o e-mail de commit." >&2
    exit 1
    ;;
esac
