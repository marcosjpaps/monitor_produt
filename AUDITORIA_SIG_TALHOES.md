> Auditoria histórica anterior às correções. Para o estado atual, consulte RELATORIO_CORRECOES.md.

# Auditoria SIG Talhoes

Alteracoes aplicadas sem modificar interface:

- Criada identificacao deterministica de talhoes por geometria SHA-256.
- Evitada dependencia exclusiva do nome do talhao.
- Normalizacao de coordenadas WGS84 antes da persistencia.
- Bloqueio de poligonos invalidos com menos de 3 pontos.
- Separacao logica entre identidade geografica e nome exibido.

A interface visual permanece inalterada.
