# 🌾 AgroTelemetry Monitor — Multi-Machine GNSS & Precision Agriculture Platform

<div align="center">

![Status](https://img.shields.io/badge/status-active-brightgreen?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.12-blue?style=flat-square&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-teal?style=flat-square&logo=fastapi)
![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square&logo=vercel)
![Database](https://img.shields.io/badge/Database-Neon%20PostgreSQL-green?style=flat-square&logo=postgresql)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

**Plataforma integrada de telemetria e operações agrícolas de precisão.**
Suporte a múltiplas máquinas, formatos de dados e visualização GIS em tempo real.

[🚀 Demo Live](https://github.com/marcosjpaps/drone) • [📖 Documentação](#-instalação-local) • [🛡️ Segurança](#️-segurança)

</div>

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Cockpits Disponíveis](#-cockpits-disponíveis)
- [Tecnologias](#️-tecnologias)
- [Instalação Local](#-instalação-local)
- [Variáveis de Ambiente](#️-variáveis-de-ambiente)
- [Deploy Vercel + Neon](#-deploy-vercel--neon)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [API Reference](#-api-reference)
- [Segurança](#️-segurança)

---

## 🌐 Visão Geral

O **AgroTelemetry Monitor** é uma plataforma web de gestão de operações agrícolas de precisão que centraliza dados de múltiplos equipamentos e sistemas:

- 🔴 **Massey Ferguson 7318** + Trimble TMX-2050 (calagem, gessagem, autoguidagem NAV-900)  
- 🟢 **John Deere 6150M** + Monitor G5 (telemetria CAN/J1939, ficheiros `.JDL`)  
- 🟠 **Jacto Uniport** + Trimble AgGPS (shapefiles de cobertura e swaths)  
- 🔵 **DJI Agras T100/T70** (logs KML de pulverização aérea)  
- 🟣 **Precision Ag Studio** (ISOXML ISO 11783, zoneamento agronômico, JDLink API)

---

## 🖥️ Cockpits Disponíveis

| Rota | Módulo | Descrição |
|------|--------|-----------|
| `/` | **Portal Hub** | Ecrã inicial de seleção de módulo |
| `/johndeere` | **John Deere G5** | Telemetria de motor, GPS e distribuição a lanço (.JDL) |
| `/jacto` | **Jacto / AgGPS** | Cobertura Shapefile, linhas AB, histórico de eventos |
| `/massey` | **Massey MF 7318** | Operações TMX-2050, SIG de talhões, 857 polígonos |
| `/drone` | **Drones DJI Agras** | KML de voos, talhões, área por missão |
| `/studio` | **Precision Studio** | ISOXML TaskData v4.3, JDLink API, zoneamento |

---

## 🛠️ Tecnologias

### Backend
| Tecnologia | Versão | Uso |
|------------|--------|-----|
| Python | 3.12 | Runtime principal |
| FastAPI | ≥0.111 | API REST + ASGI |
| Uvicorn | ≥0.29 | Servidor HTTP |
| SQLite | (local) | Base de dados de desenvolvimento |
| PostgreSQL/Neon | (produção) | Base de dados serverless |
| GDAL/OGR via QGIS | 3.44.11 | Parsing geoespacial (SHP, KML, GeoJSON) |
| SQLAlchemy + Alembic | ≥2.0 | ORM e migrações |

### Frontend
| Tecnologia | Versão | Uso |
|------------|--------|-----|
| HTML5 / CSS3 / Vanilla JS | — | Interface sem frameworks |
| Leaflet.js | 1.9.4 | Mapas interativos |
| Lucide Icons | latest | Ícones SVG |
| shp.js | latest | Parsing shapefile no browser |
| Google Fonts (Plus Jakarta Sans) | — | Tipografia |

### DevOps & Deploy
| Serviço | Uso |
|---------|-----|
| **Vercel** | Hosting frontend + API serverless |
| **Neon** | PostgreSQL serverless (produção) |
| **GitHub Actions** | CI/CD (em configuração) |

---

## ⚙️ Instalação Local

### Pré-requisitos
- Python 3.12+
- QGIS 3.x (para GDAL/OGR — opcional em produção com `gdal` PyPI)
- Git

### 1. Clonar o repositório
```bash
git clone https://github.com/marcosjpaps/drone.git
cd drone
```

### 2. Criar e ativar ambiente virtual
```bash
# Windows
python -m venv venv
venv\Scripts\activate

# Linux/macOS
python3 -m venv venv
source venv/bin/activate
```

### 3. Instalar dependências
```bash
pip install -r requirements.txt
```

### 4. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edite o ficheiro .env com os seus valores
```

### 5. Iniciar o servidor de desenvolvimento
```bash
python run_app.py
```

O dashboard abre automaticamente em: **http://127.0.0.1:8000**

---

## 🔑 Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | ✅ Produção | URL completa Neon PostgreSQL com `sslmode=require` |
| `APP_SECRET_KEY` | ✅ | Chave secreta para sessões (min 32 chars) |
| `APP_ENV` | ✅ | `development` ou `production` |
| `SQLITE_DB_PATH` | Dev | Caminho para telemetria.db local |
| `MASSEY_DB_PATH` | Dev | Caminho para trimble_data.db local |
| `AGGPS_DATA_PATH` | Dev | Pasta com dados Shapefile AgGPS |
| `JDLINK_CLIENT_ID` | Opcional | Client ID da JDLink API v4 |
| `JDLINK_CLIENT_SECRET` | Opcional | Secret da JDLink API v4 |
| `MAX_UPLOAD_SIZE_MB` | Opcional | Limite de upload (default: 50 MB) |

> ⚠️ **Nunca** versione o ficheiro `.env` — está no `.gitignore`.

---

## 🚀 Deploy Vercel + Neon

### 1. Criar base de dados no Neon
1. Aceda a [console.neon.tech](https://console.neon.tech)
2. Crie um novo projeto → copie a `DATABASE_URL`
3. Execute o schema SQL:
```bash
psql "$DATABASE_URL" -f schema.sql
```

### 2. Deploy na Vercel
```bash
# Instalar Vercel CLI
npm i -g vercel

# Login e deploy
vercel login
vercel --prod
```

### 3. Configurar variáveis na Vercel
No painel Vercel → Settings → Environment Variables, adicione:
- `DATABASE_URL` — URL do Neon com `sslmode=require`
- `APP_SECRET_KEY` — Chave aleatória segura
- `APP_ENV=production`

---

## 📁 Estrutura do Projeto

```
drone/
├── api/
│   └── index.py              # Entrada serverless Vercel
├── backend/
│   ├── main.py               # App FastAPI + todas as rotas
│   ├── db.py                 # Camada SQLite (dev) / PostgreSQL (prod)
│   ├── parser.py             # Parser .JDL (John Deere CAN/J1939)
│   ├── aggps_parser.py       # Parser AgGPS (Coverage.shp, Swaths, EventHistory)
│   ├── massey_engine.py      # Motor Massey Ferguson / Trimble TMX-2050
│   ├── isoxml_engine.py      # Parser ISOXML ISO 11783 TaskData
│   ├── jd_ops.py             # Operações John Deere (filtros, KPIs)
│   ├── jdlink_bridge.py      # Bridge JDLink API v4
│   └── zoning_engine.py      # Zoneamento agronômico (grade, CV%)
├── frontend/
│   ├── portal.html           # Hub principal de módulos
│   ├── index.html            # Cockpit John Deere G5
│   ├── jacto.html            # Cockpit Jacto / AgGPS
│   ├── massey.html           # Cockpit Massey Ferguson / TMX-2050
│   ├── drone.html            # Cockpit Drones DJI Agras
│   ├── studio.html           # Precision Ag Studio
│   ├── css/style.css         # Design system global (dark navy)
│   ├── js/app.js             # Lógica GIS, Leaflet, tabelas
│   └── shp.js                # Parser Shapefile client-side
├── samples/
│   ├── myjohndeere_application/  # Amostras MyJohnDeere Application Map
│   ├── myjohndeere_harvest/      # Amostras MyJohnDeere Harvest Map
│   └── myjohndeere_seeding/      # Amostras MyJohnDeere Seeding Map
├── .env.example              # Template de variáveis de ambiente
├── .gitignore                # Regras de exclusão Git
├── schema.sql                # Schema PostgreSQL (Neon)
├── vercel.json               # Configuração de deploy Vercel
├── requirements.txt          # Dependências Python
├── run_app.py                # Inicializador local
└── README.md                 # Este ficheiro
```

---

## 📡 API Reference

### John Deere G5
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/dashboard/kpis` | KPIs operacionais com filtros |
| `GET` | `/api/dashboard/series` | Séries temporais (RPM, velocidade, combustível) |
| `GET` | `/api/dashboard/mapa` | Coordenadas GPS para mapa Leaflet |
| `POST` | `/api/upload` | Upload de ficheiros .JDL |

### Massey Ferguson / Trimble TMX-2050
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/massey/stats` | Estatísticas consolidadas (25 ops, 310 ha, 857 talhões) |
| `GET` | `/api/massey/operations` | Lista de operações com filtros |
| `GET` | `/api/massey/operations/{uuid}` | Detalhe de operação + manifest.xml |
| `GET` | `/api/massey/farm-fields` | Talhões SIG com cruzamento de operações |
| `GET` | `/api/massey/farm-fields/geojson` | GeoJSON para Leaflet |

### Jacto / AgGPS
| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/jacto/kpis` | KPIs de cobertura (409 ha, 28.765 polígonos) |
| `GET` | `/api/jacto/cobertura` | GeoJSON de cobertura Shapefile |
| `GET` | `/api/jacto/linhas-guia` | Linhas AB e curvas de piloto automático |
| `GET` | `/api/jacto/eventos` | Histórico de sessões (EventHistory.dbf) |
| `GET/POST` | `/api/jacto/config_dir` | Gestão de pasta AgGPS local |

---

## 🛡️ Segurança

### Medidas Implementadas
- ✅ **Sem credenciais em código** — todas via variáveis de ambiente
- ✅ **Validação de uploads** — tipo MIME, extensão, tamanho máximo
- ✅ **Path Traversal / Zip Slip** — sanitização de caminhos em todos os parsers
- ✅ **Headers de Segurança** — `X-Frame-Options`, `X-XSS-Protection`, `CSP` via Vercel
- ✅ **SSL obrigatório** — `sslmode=require` em todas as ligações Neon
- ✅ **.gitignore abrangente** — exclui `.env`, `.db`, uploads e caches

### Reportar Vulnerabilidades
Para reportar uma vulnerabilidade de segurança, contacte diretamente o mantenedor do repositório em vez de abrir uma issue pública.

---

## 📊 Dados de Produção Suportados

| Formato | Equipamento | Dados Extraídos |
|---------|-------------|-----------------|
| `.JDL` | John Deere G5 | RPM, velocidade, combustível, GPS, J1939 |
| `.AGF` / `.AES` | Trimble TMX-2050 | Operações, manifest.xml, geometria de swaths |
| `Coverage.shp` | Jacto / AgGPS | Polígonos de cobertura, taxa, produto |
| `Swaths.shp` | Trimble AgGPS | Linhas AB, curvas de piloto automático |
| `EventHistory.dbf` | AgGPS | Sessões, operadores, durações, volumes |
| `.KML` | DJI Agras | Missões, waypoints, área, calda |
| `TASKDATA.xml` | ISOXML ISO 11783 | TaskData, DDI, campos, maquinaria |

---

## 📄 Licença

MIT License — © 2026 AgroTelemetry Monitor Contributors

---

<div align="center">
<sub>Desenvolvido com 🌾 para operações agrícolas de precisão | Powered by FastAPI + Vercel + Neon</sub>
</div>
