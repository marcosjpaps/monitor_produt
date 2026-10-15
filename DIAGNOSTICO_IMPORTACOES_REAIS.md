# Importações reais — 15/10/2026

Inspeção sem publicar arquivos, coordenadas, nomes de clientes ou credenciais no Git.

| Arquivo | Compactado (bytes) | Entradas | Expandido (bytes) | Diagnóstico reproduzido |
|---|---:|---:|---:|---|
| AgData.zip | 21.347.184 | 146 | 21.486.506 | Dois SHP, 296 feições abertas; 56 AGF proprietários misturados. O importador da main já consegue importar as geometrias abertas: não foi reproduzida uma falha de banco nesse arquivo. |
| jactor.zip | 17.241.770 | 121 | 38.628.469 | AgGPS legível: cinco SHP e 28.771 feições; inclui outros formatos proprietários e um RAR interno que não são decodificados pelo leitor AgGPS. |
| trator masser.zip | 108.078.809 | 113 | 218.271.207 | Rejeitado pelo limite de 50 MiB antes do parser. Sem geometria aberta reconhecida; 26 AGF e arquivos de suporte/logs. Um AGF inspecionado contém manifest.xml e payload .xml.gz.enc, não coordenadas abertas. |
| JD-Data.zip | 309.976.058 | 8.218 | 932.053.909 | Excede tanto o upload de 50 MiB como a extração de 500 MiB. 8.116 JDL válidos, 74.057 pontos. |
| JD-Data - Copia.zip | 460.557.585 | 8.810 | 1.409.954.615 | Mesmos limites excedidos. 8.705 JDL válidos, 94.454 pontos. |

Todos os 16.821 JDL foram percorridos pelo parser, sem erros. Não foram encontrados conteúdos SHA-256 repetidos entre eles; o nome “Copia” não significa que os dois ZIPs contenham os mesmos logs. Isso não substitui a verificação de duplicados do banco.

## Correções

- A Central lê o diretório ZIP no navegador e envia cada JDL individualmente, preservando a pasta da atividade. Aceita ZIP John Deere até 1 GiB e limita cada membro a 50 MiB, sem aumentar os limites de extração do servidor. Os JDL acima de 2 MiB continuam usando partes de 2 MiB. A leitura valida CRC, tamanho, caminhos, método, quantidade e expansão; ZIP64, volumes divididos e ZIP com senha são recusados.
- Os dois ZIPs reais tiveram seu diretório e os membros inicial, maior e final verificados também pelo leitor JavaScript, incluindo CRC. O teste no Edge validou os diretórios completos e a extração dos maiores membros reais, além da interface em desktop e celular.
- A Central identifica pacotes Massey sem geometria aberta antes do envio; AgData informa que os AGF proprietários não foram decodificados. Falhas parciais de pacotes não são registradas como sucesso completo nem bloqueiam nova tentativa pelo hash do pacote.
- Cada gravação JDL usa savepoint: uma falha SQL não deixa a transação PostgreSQL inutilizável para os próximos arquivos. A checagem de duplicados consulta o hash com índice, sem carregar todo o histórico a cada JDL.
- O leitor SHP respeita CPG; a persistência converte datas DBF para ISO antes de serializar GeoJSON. São regressões preventivas verificadas com fixture Latin-1/data; não foram identificadas como a causa da falha do AgData real, que já passa na main.
- A entrada autenticada sempre leva ao painel inspirado no Drone, inclusive com o antigo parâmetro hub. O portal alternativo e seus links foram removidos da navegação principal. As APIs agrícolas e a autenticação por cookie permanecem.

## Evidências e isolamento

- 8 testes Node e 7 testes Python passaram. Testes novos cobrem ZIP armazenado/deflate, CRC, caminhos inseguros, limites e CPG/data/duplicação. O teste de autenticação agora fecha o banco antes de apagar sua pasta temporária no Windows.
- AgData: 296 inserções em SQLite isolado, zero novas no reenvio. Na branch Neon `test-real-imports-20261015` (`br-summer-truth-b5c5d6oy`), o SQL produzido pelos parsers reais gravou as 296 feições e duas sessões JDL com três pontos, sem erro. Essa é uma validação de persistência no PostgreSQL, não um teste completo HTTP.
- Jacto: ZIP persistido e reidratado em banco temporário; 70 arquivos recuperados e verificados por SHA-256, sem nova entrada no reenvio. Cinco SHP abertos pelo leitor real, com contagens 1, 1.860, 5, 13.187 e 13.718.
- Produção: somente consultas de metadados/contagens via conector Neon. Nenhuma escrita de dados ou migração foi executada por este trabalho na branch de produção. As 296 linhas de farm_fields já existiam; sessões e pontos estavam zerados na consulta.
- O Edge local usou respostas simuladas para todas as APIs; não acessou produção. As imagens de inspeção são entregues separadamente, não versionadas.

## Limitações e validação pendente

- O fluxo completo autenticado no preview precisa apontar para a branch isolada do Neon antes de enviar arquivos. A revisão automática bloqueou o envio da conexão privilegiada para as variáveis de preview da Vercel; foi solicitada autorização explícita. Nenhum contorno foi aplicado.
- A configuração atual de startup pode executar DDL idempotente. Não testar APIs dinâmicas em um preview que possa herdar DATABASE_URL de produção.
- Não houve promoção, merge ou importação de produção. O PR permanece separado da main.
- Payload Trimble criptografado exige exportação KML/SHP/GeoJSON pelo equipamento. Não é possível inventar telemetria a partir do manifest.
- Enviar milhares de JDL individualmente pode levar tempo; manter a página aberta. Uma nova tentativa ignora os hashes já gravados. A duração de todos os uploads na Vercel ainda não foi medida.
- Não foi possível correlacionar a falha histórica com uma stack de produção: os logs antigos ultrapassam a retenção disponível. A consulta dos últimos 30 minutos não retornou erros.
- O comando genérico npm test inclui testes antigos de Drone que referenciam arquivos e APIs ausentes nesta aplicação. Foram executadas as suítes agrícolas/autenticação usadas na CI e os testes novos; não é declarado que a suíte histórica genérica passou.
