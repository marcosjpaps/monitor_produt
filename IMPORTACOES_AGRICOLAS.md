# Importações agrícolas como no Drone — Monitor Agrícola

## Central de importações

Na rota `/importacoes`, o usuário autenticado seleciona o equipamento, escolhe ou arrasta até 50 arquivos por lote, acompanha o progresso e vê os registros guardados no PostgreSQL. Arquivos de até 2 MB usam upload comum; acima disso a interface os envia em partes de 2 MB, que são remontadas no banco antes da validação pelo parser. O limite lógico de arquivo é de 50 MB; a função na Vercel ainda pode ter limite de tempo de execução, especialmente em pacotes grandes.

| Módulo | Formatos admitidos na central | Destino dos dados |
|---|---|---|
| John Deere G5 | JDL nativo, ZIP/RAR contendo JDL | Parser JDL existente: telemetria e rastros reais |
| Jacto / AgGPS | ZIP com SHP/SHX/DBF, RAR, JDL; KML apenas no modo geometria | Pacote AgGPS persistido em `monitor_imports.file_data`, reconstituído temporariamente em `/tmp` na nuvem |
| Massey / TMX | ZIP com Shapefile completo, AGF aberto; KML/GeoJSON no modo geometria | Dados abertos em `agricultural_operations` e `farm_fields` |
| Stara | ZIP com Shapefile aberto; KML/GeoJSON no modo geometria | Parser geográfico comum, preservando atributos reais identificados |
| Case IH | ZIP com Shapefile aberto; KML/GeoJSON no modo geometria | Parser geográfico comum, preservando atributos reais identificados |
| Trimble | ZIP com Shapefile aberto, AGF aberto; KML/GeoJSON no modo geometria | Parser geográfico comum, com dados armazenados no PostgreSQL |

**Importante:** para todos os leitores geográficos, se o Shapefile tiver arquivos SHP/DBF/SHX/PRJ separados, **compacte todos no mesmo ZIP** antes de enviar pela central. Assim o parser recebe o conjunto completo. Um SHP solto sem DBF normalmente não tem geometria/atributos suficientes. O formato AGF criptografado precisa ser exportado pelo equipamento.

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

## Pré-validação de aplicação (agFileValidator.ts adaptado)

- A regra é aplicada **no servidor**, tanto na importação direta quanto na finalização de arquivos enviados em partes. Ela usa `backend/ag_file_validator.py`, adaptado do validador TypeScript enviado pelo usuário, sem exigir JSZip no site estático.
- ZIP é inspecionado por caminhos inseguros, limites de quantidade/tamanho, presença da tríade SHP/SHX/DBF, cabeçalhos SHP/DBF, geometrias vazias, colunas de aplicação e projeção. Camadas de bordadura, limites e linhas AB são ignoradas; prescrição com taxa alvo, mas sem taxa real, é rejeitada.
- O registro de **taxa aplicada** é tratado separadamente de vazão. Apenas velocidade/largura não comprovam dose aplicada. Ausência de PRJ quando o CRS não é inequívoco produz diagnóstico e nunca autoriza inventar coordenadas.
- Arquivos **JDL** e ZIP com JDL continuam passando ao parser John Deere, que precisa validar o conteúdo antes da gravação.
- Pacotes **ISOXML/TASKDATA com TimeLog** são identificados mas ainda **não são importados como aplicação**: validar que `TLG*.BIN` existe não equivale a decodificar posição, DDIs e quantidade aplicada.
- RAR John Deere/Jacto e AGF aberto têm validação posterior nos parsers existentes; cabeçalhos isolados não atestam telemetria.
- A opção **Importar somente geometria** é voluntária e desativada por padrão; KML/GeoJSON não são apresentados como taxa/velocidade de aplicação. A importação de componentes SHP isolados exige compactação e não é enviada à central como aplicação válida.
- As origens Stara, Case IH e Trimble usam o leitor geográfico existente de formatos **abertos**, não um decoder de formatos proprietários. No painel de mapa, são vistas na aba compartilhada **Massey / Trimble / Outros**; o histórico mantém a seleção de marca.
- O relatório de validação aparece no resultado do upload com marca inferida, camadas aceitas, ignoradas, avisos e arquivos faltantes. A marca é inferência por metadados; não é identificação criptográfica do fabricante.

### Estado de testes e limitações

A bateria `tests/test_ag_file_validator.py` inclui JDL legado, SHP válido, DBF ausente, Rx, cobertura sem taxa, KML apenas em modo geometria, ZIP corrompido, bordadura e ZIP de JDL. Os cabeçalhos e heurísticas não substituem testes com exportações reais de cada marca e um ciclo completo no Neon/Vercel. Não migra nem remove importações históricas.
