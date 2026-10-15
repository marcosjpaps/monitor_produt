# Importações agrícolas como no Drone — Monitor Agrícola

## Central de importações

Na rota `/importacoes`, o usuário autenticado seleciona o equipamento, escolhe ou arrasta até 50 arquivos por lote, acompanha o progresso e vê os registros guardados no PostgreSQL. Arquivos de até 2 MB usam upload comum; acima disso a interface os envia em partes de 2 MB, que são remontadas no banco antes da validação pelo parser. O limite lógico de arquivo é de 50 MB; a função na Vercel ainda pode ter limite de tempo de execução, especialmente em pacotes grandes.

| Módulo | Formatos admitidos na central | Destino dos dados |
|---|---|---|
| John Deere G5 | JDL, ZIP, RAR | Máquinas, rastros, telemetria, indicadores e arquivos processados nas tabelas existentes |
| Jacto / AgGPS | ZIP, RAR, SHP, DBF, SHX, PRJ, XML, KML, JDL | ZIP/componentes AgGPS persistidos em `monitor_imports.file_data`; o sistema os reconstrói em `/tmp` para os mapas. JDL importa dados de telemetria John Deere |
| Massey / Trimble | ZIP, AGF aberto, SHP com componentes, KML, GeoJSON, JSON | Operações e polígonos nas tabelas `agricultural_operations` e `farm_fields` |

**Importante:** para o Massey, se o Shapefile tiver arquivos SHP/DBF/SHX/PRJ separados, **compacte todos no mesmo ZIP** antes de enviar pela central. Assim o parser recebe o conjunto completo. Um SHP solto sem DBF normalmente não tem geometria/atributos suficientes. O formato AGF criptografado precisa ser exportado pelo equipamento.

O arquivo original em formato binário é persistido **apenas para o Jacto/AgGPS**. Para John Deere/Massey, persiste-se o resultado estruturado e o histórico (hash, nome, tamanho, quantidade e data), evitando duplicação de grandes arquivos binários já processados.

## Histórico e duplicados

O hash SHA-256 identifica conteúdo repetido por módulo. Arquivos idênticos não são reprocessados pela central. O histórico é paginado, filtrável por equipamento e exibe estados de importação. `Arquivar` e `Restaurar` mantêm o histórico recuperável.

Arquivar um item **não apaga o registro agronômico** de John Deere/Massey (a exclusão/restauração real de rastros e operações é gerenciada nos módulos). Para o Jacto, arquivar impede que o arquivo seja reconstituído na nuvem; restaurar volta a disponibilizá-lo. As operações importadas anteriormente fora da central não são migradas nem apagadas automaticamente.

## Confiabilidade / implantação

- Banco: `DATABASE_URL`/Neon configurado como variável sensível; nunca no Git.
- Login: requer PR de autenticação server-side preparado em `security/monitor-auth-env-20261015`, com `APP_ADMIN_EMAIL`, `APP_ADMIN_PASSWORD`, `APP_SECRET_KEY`. **Não publique sem configurar essas variáveis.**
- Vercel: publicar somente pelo projeto ligado a `marcosjpaps/monitor_produt`.
- O backend faz migrações idempotentes, usa transações PostgreSQL para não confirmar parcialmente as operações da mesma transação, bloqueia requisições não autenticadas e valida ZIP e coordenadas conforme os parsers dos módulos.
- Importações antigas feitas diretamente pelos módulos continuam disponíveis. Para ter um histórico unificado das importações antigas, seria necessária uma migração separada com inspeção dos dados do banco real.
- Upload de partes incompletas expira após 1 dia na tabela transitória.
- Testes unitários da camada de histórico e reconstituição Jacto rodam na CI com banco SQLite simulado; **a ligação real ao Neon, importações grandes e o fluxo ponta a ponta na Vercel ainda exigem testes no ambiente configurado**.
