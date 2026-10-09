# Versão corrigida do Monitor Agrícola

Comece por [LEIA_PRIMEIRO.md](LEIA_PRIMEIRO.md). As correções e os resultados estão em [RELATORIO_CORRECOES.md](RELATORIO_CORRECOES.md).

As instruções abaixo são a documentação histórica do pacote original; para instalar e abrir esta versão, use o guia acima.

---

# 🌾 AgroTelemetry Monitor — Multi-Machine GNSS & Precision Agriculture Platform

<div align="center">

![Status](https://img.shields.io/badge/status-active-brightgreen?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.12-blue?style=flat-square&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-teal?style=flat-square&logo=fastapi)
![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)
![Database](https://img.shields.io/badge/Database-PostgreSQL%20%2F%20SQLite-blue?style=flat-square&logo=postgresql)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

**Plataforma integrada de telemetria e operações agrícolas de precisão.**  
Suporte a múltiplas máquinas, formatos de dados e visualização GIS em tempo real.

</div>

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Cockpits Disponíveis](#-cockpits-disponíveis)
- [Tecnologias](#️-tecnologias)
- [Instalação e Execução Local](#-instalação-e-execução-local)
- [Variáveis de Ambiente](#️-variáveis-de-ambiente)
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
| `/massey` | **Massey MF 7318** | Operações TMX-2050, SIG de talhões, polígonos |
| `/drone` | **Drones DJI Agras** | KML de voos, talhões, área por missão |
| `/studio` | **Precision Studio** | ISOXML TaskData v4.3, JDLink API, zoneamento |

---

## 🛠️ Tecnologias

### Frontend
- **HTML5 / Vanilla CSS3 / JavaScript (ES2022)** — sem frameworks pesados
- **Leaflet.js 1.9.4** — motor cartográfico GIS client-side
- **shp.js** — parser client-side de Shapefiles (`.shp`, `.dbf`, `.zip`)
- **Lucide Icons** — iconografia moderna

### Backend & Processamento
- **FastAPI (Python 3.12)** — backend de telemetria de máquinas pesadas e parsers binários
- **Node.js** — servidor web e APIs de voos e talhões (`server.js`)
- **PostgreSQL / SQLite** — banco de dados relacional e geoespacial
- **Shapely & PyProj** — transformações de projeção e álgebra geoespacial

---

## 💻 Instalação e Execução Local

### 1. Pré-requisitos
- **Node.js 18+** e **npm**
- **Python 3.12+**
- **PostgreSQL** (ou SQLite para desenvolvimento local)

### 2. Instalar dependências Node.js
```bash
npm install
```

### 3. Iniciar o servidor local (Porta 3000)
```bash
npm start
# ou simplesmente execute iniciar_site.bat no Windows
```
Acesse no navegador: `http://localhost:3000`

### 4. Iniciar o backend Python (opcional para telemetria JD/Massey/Jacto)
```bash
pip install -r backend/requirements.txt
python run_app.py
# ou execute iniciar_dashboard.bat no Windows
```

---

## 🔑 Variáveis de Ambiente

Configure o arquivo `.env` a partir do modelo `.env.example`:

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | Opcional | URL de conexão PostgreSQL (`postgresql://postgres:senha@localhost:5432/agrodrone`) |
| `PORT` | Opcional | Porta do servidor Node.js (padrão: 3000) |
| `APP_SECRET_KEY` | Opcional | Chave secreta para sessões |
| `APP_ENV` | Opcional | `development` ou `production` |

---

## 📁 Estrutura do Projeto

```
drone/
├── api/                      # Handlers das rotas de voos, talhões e importação
│   ├── db.js                 # Conexão com banco de dados PostgreSQL
│   ├── voos.js               # API de consulta e salvamento de voos
│   ├── talhoes.js            # API de consulta e salvamento de talhões
│   └── import.js             # API de importação e processamento de logs
├── backend/                  # Motor Python de telemetria de máquinas agrícolas
│   ├── main.py               # Aplicação FastAPI
│   ├── db.py                 # Camada SQLite/PostgreSQL
│   ├── parser.py             # Parser .JDL (John Deere)
│   ├── aggps_parser.py       # Parser Trimble AgGPS
│   └── massey_engine.py      # Motor Massey Ferguson / Trimble TMX-2050
├── frontend/                 # Interfaces web e dashboards
│   ├── portal.html           # Portal central
│   ├── drone.html            # Mapa de drones
│   └── ...
├── scripts/                  # Scripts de teste e migração de banco
│   ├── migrate.js            # Criação de tabelas e índices
│   └── test_flow.js          # Validação do fluxo de dados
├── index.html                # Aplicação web principal (Mapa de Aplicação e Talhões)
├── server.js                 # Servidor local Node.js
├── schema.sql                # Schema DDL do PostgreSQL
├── package.json              # Dependências e scripts Node.js
└── README.md                 # Documentação
```

---

## 🛡️ Segurança

- ✅ **Sem dependências externas de nuvem proprietária** — Execução 100% autônoma e local
- ✅ **Sanitização de arquivos** — Proteção contra Zip Slip e Path Traversal
- ✅ **Consultas SQL Parametrizadas** — Prevenção contra injeção SQL
- ✅ **Validação de Telemetria** — Douglas-Peucker e sanitização de pontos espúrios

---

<div align="center">
<sub>Desenvolvido com 🌾 para operações agrícolas de precisão</sub>
</div>
