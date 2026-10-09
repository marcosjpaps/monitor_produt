# Correções e validação — 09/10/2026

## Alterações implementadas

- Um único endereço para portal, painéis e APIs. O inicializador inicia Node e Python, espera o backend responder e abre o navegador.
- Arquivos públicos servidos por lista permitida. `.env`, backend, bancos, dependências e scripts internos não são disponibilizados.
- Upload binário multipart preservado; JSON inválido retorna erro; limite de 50 MB por arquivo. ZIPs têm validação de caminhos, links e tamanho descompactado.
- SQLite local persistente como configuração inicial; PostgreSQL opcional. Migrações incluem `kml_url`, `importacoes` e vínculos. Operações de gravação dos drones são transacionais.
- Exclusão, lixeira, restauração e contagens baseadas nos registros efetivamente encontrados. Importação parcial de um lote de voos não deixa gravações anteriores quando há erro.
- Coordenadas inválidas rejeitadas, sem substituição por `[0,0]` e sem troca automática de latitude/longitude. Pontos originais preservados, sem simplificação destrutiva automática.
- Associação espacial com o polígono real, incluindo trajetórias que atravessam o talhão sem pontos interiores. Percentual de cobertura não é inferido de retângulos.
- Talhões inválidos retornam erro antes de executar SQL. Alterações nos talhões recalculam os vínculos e removem associações antigas.
- Massey: criação/migração do banco, upload real de geometrias abertas, prevenção de duplicatas, sincronização da pasta e exclusão. Controles, filtros, camadas, tabela, detalhes, painel e estilos alinhados ao JavaScript existente.
- SHP/DBF lidos com PyShp; PRJ convertido para WGS84 usando PyProj. O backend não depende mais de uma instalação específica de GDAL/QGIS.
- Jacto preserva diretórios e componentes dos pacotes. Valores fictícios de velocidade, taxa e operador foram removidos. Datas de eventos são normalizadas.
- JDLink retorna estado não configurado. Números fixos do portal e indicadores sem dados foram removidos. O consumo John Deere é rotulado como estimativa.
- Tema, cores e estrutura preservados; acabamento de cartões, foco de teclado, rolagem, organização do Massey e adaptação do portal a telas estreitas.

## Verificações executadas

- Testes integrados da API com SQLite e PGlite, incluindo bloqueio de arquivos internos, páginas distintas, uploads, duplicatas, validação, vínculos, exclusão, restauração, histórico, rollback e persistência após reiniciar.
- Testes de parsers com KML DJI real do pacote, unidades, CSV, coordenadas inválidas e geometria fora de um talhão triangular.
- Cinco testes Python com endpoints dos módulos, upload/duplicata/exclusão Massey, KML cadastral, ZIP malicioso, transformação de Shapefile projetado, importação Jacto e exclusão/restauração de sessões John Deere.
- Navegador Chromium: portal, John Deere, Jacto, Massey e drones sem erros de JavaScript e sem respostas HTTP de erro dos recursos locais. Massey também foi testado com upload GeoJSON, filtro, limpeza de filtro, abas, camadas e detalhes. Navegação móvel verificada em 390×844.
- Sintaxe dos arquivos Python e de 24 arquivos/blocos JavaScript verificada.
- `open-dronelog`: TypeScript e compilação Vite web concluídos. O build registra aviso de tamanho do bundle principal; o uso desktop/Tauri não foi validado.

## Limites reais

Esta validação não significa compatibilidade universal com todo monitor ou versão de arquivo. Não havia um log JDL real nem exportação AGF decodificada no pacote para testar os dados da máquina. A persistência John Deere foi exercitada com uma sessão de teste. JDL sem estrutura reconhecida é rejeitado.

PGlite valida consultas PostgreSQL, mas não substitui um teste de conexão com o PostgreSQL de produção. Credenciais, SSL, permissões, dados existentes e conectividade precisam ser verificados no destino.

AGF criptografado exige exportação aberta do monitor. Nenhuma integração real JDLink foi criada sem credenciais/autorização. Sem geometria de aplicação não é possível afirmar percentual de área aplicada. Alguns cálculos do parser JDL original usam modelos de consumo, largura padrão e classificação operacional; valide esses valores com a configuração efetiva do implemento antes de decisões agronômicas.

Nos testes visuais, serviços externos de mapas/fontes foram bloqueados; a interface, os dados e as geometrias locais funcionaram. Imagens de satélite dependem do acesso aos respectivos provedores. Não foi gerado nem testado instalador desktop Windows do open-dronelog.
