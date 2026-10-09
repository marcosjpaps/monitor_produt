# Monitor Agrícola — versão corrigida

O portal mantém o tema escuro, as cores das marcas e os três módulos selecionados: John Deere, Jacto e Massey. Os atalhos de Precision Studio, JDLink e DJI foram retirados da navegação. A implementação legada de drones foi preservada em `/drone` para manter os arquivos e permitir validar as correções de voos.

## Instalar e abrir no Windows

1. Instale Node.js 22.13 ou superior e Python 3.10 ou superior.
2. Extraia todo o ZIP em uma pasta.
3. Execute `instalar.bat` com acesso à internet.
4. Execute `iniciar_dashboard.bat`. O portal abre em `http://127.0.0.1:3000`.

Mantenha o terminal aberto. `iniciar_site.bat` abre o mesmo sistema. Não abra as páginas HTML diretamente: elas precisam das APIs. Sem configuração adicional, o banco de drones usa SQLite persistente em `data/drone.sqlite`; John Deere e Massey usam seus bancos SQLite próprios. Não é necessário instalar PostgreSQL nem QGIS para o uso local.

Para usar PostgreSQL, copie `.env.example` para `.env` e configure `DATABASE_URL`. O esquema é criado/atualizado na inicialização. Não copie arquivos de credenciais para pastas públicas. Dados de um PostgreSQL antigo não são transferidos automaticamente ao SQLite.

## Importar dados

- **John Deere:** logs `.JDL` e ZIP/RAR com logs. SHP de talhões também pode ser importado pelo mapa. As amostras MyJohnDeere só aparecem se seus arquivos SHP estiverem presentes; o pacote original trouxe apenas os JSON de metadados.
- **Jacto:** ZIP com a estrutura original AgGPS, incluindo SHP, DBF, SHX e PRJ. A estrutura de fazenda/talhão/evento é preservada. Componentes enviados avulsos são salvos para compor o conjunto.
- **Massey:** KML, GeoJSON e ZIP com Shapefiles; é possível enviar uma pasta ou sincronizar `MASSEY_TRACTOR_FOLDER`. Polígonos cadastrais entram como talhões; trajetórias e feições identificadas com `operation_type` entram como operações. Campos desconhecidos ficam sem informação.
- **Drones preservados:** KML com uma trajetória por arquivo, CSV com latitude/longitude ou JSON com `flights`. CSV sem cabeçalho usa `longitude,latitude`. Arrays internos usam `[latitude, longitude]`; GeoJSON usa `[longitude, latitude]`.

AGF proprietário/criptografado não é decodificado por esta versão. Exporte KML, SHP ou GeoJSON no monitor Trimble. O sistema informa a rejeição, em vez de confirmar uma importação inexistente. A integração JDLink autenticada não está configurada e não apresenta frota simulada como conexão real.

O vínculo voo/talhão usa a trajetória e o polígono real. O percentual de área aplicada fica indisponível quando não existe geometria de aplicação; uma trajetória por si só não comprova cobertura. Polígonos do módulo legado de drones são anéis simples. Para contornos com ilhas/furos, use GeoJSON completo no Massey.

As bibliotecas de mapas, gráficos e ícones estão incluídas. Imagens de satélite, mapas de ruas e fontes externas dependem de internet. O servidor abre apenas no computador local por padrão.

## Verificar a instalação

```text
npm test
.venv\Scripts\python -m pip install -r tests\requirements.txt
.venv\Scripts\python -m unittest discover -s tests -p "test_*.py" -v
```

Consulte `RELATORIO_CORRECOES.md` para alterações, resultados e limites da validação. As capturas em `tests/` mostram uma fixture de teste, não operações reais da fazenda.

O projeto `open-dronelog` é um aplicativo separado. Sua compilação web passou (`npm ci` e `npm run build:web` nessa pasta). A versão desktop Tauri não foi compilada; o ZIP não contém um instalador Windows desse aplicativo.
