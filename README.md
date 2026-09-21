# 🌾 VeredasDrone - Mapa de Aplicação & Atributos

Plataforma web para consolidação, visualização geográfica e análise agronômica de dados de telemetria e rastros de pulverização com drones agrícolas (DJI Agras T100, T70, etc.).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## 🚀 Funcionalidades

- **🗺️ Mapa Interativo**: Visualização vetorial dos rastros de voo (Canvas Renderer de alto desempenho para centenas de milhares de pontos GPS).
- **🌾 Importação de Talhões e Fazendas**:
  - Leitura nativa de **Shapefile** (`.zip` ou arquivos avulsos `.shp` + `.dbf` + `.prj`).
  - Compatibilidade total com arquivos **KML**.
  - Conversor geodésico automático de coordenadas métricas **UTM (Fuso 23S, 22S, 21S, 24S / SIRGAS 2000)** diretamente para GPS Lat/Lon no Brasil.
  - Vinculação espacial automática: cada voo identifica a qual **Fazenda**, **Talhão** e **Variedade** pertence.
- **📊 Estatísticas Consolidadas**:
  - Área total aplicada (ha).
  - Volume de calda total (L) e taxa média de aplicação (L/ha).
  - Tempo de voo e contagem de pontos GPS.
  - Médias de faixa de aplicação (Route Spacing), altura e velocidade de tarefa.
- **🔍 Filtros Dinâmicos**:
  - Filtro por modelo de drone.
  - Seleção múltipla de datas com calendário integrado.
  - Filtro por Fazenda e por Talhão.
  - **Seleção por Área no Mapa**: arraste um retângulo sobre o mapa para isolar voos específicos ou excluir rotas indesejadas.
- **📤 Exportação de Relatórios**:
  - **Planilha CSV Completa**: com todas as colunas agronômicas e operacionais.
  - **KML Unificado**: para abrir no Google Earth ou importar em outros sistemas GIS.

---

## 🌐 Hospedagem no Vercel

Este projeto é 100% estático (HTML/JS/CSS), dispensando servidores backend:
1. Conecte o repositório GitHub ao [Vercel](https://vercel.com).
2. Clique em **Deploy**.
3. O Vercel publicará o aplicativo instantaneamente no endereço `https://seu-projeto.vercel.app`.
