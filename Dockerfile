FROM nikolaik/python-nodejs:python3.12-nodejs22

# Configurar o diretório de trabalho
WORKDIR /app

# Copiar os arquivos de dependências primeiro (melhora o cache do Docker)
COPY package*.json ./
COPY backend/requirements.txt ./backend/

# Instalar dependências Node.js
RUN npm ci

# Instalar dependências Python
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copiar o restante do código
COPY . .

# Variáveis de ambiente para usar o banco de dados persistente na pasta /data
ENV PORT=3000
ENV START_PYTHON=true
ENV DRONE_DB_PATH=/data/drone.sqlite
ENV TELEMETRY_DB_PATH=/data/telemetria.db

# Expor a porta que o Node vai usar
EXPOSE 3000

# Comando para iniciar o servidor (inicia Node + Python automaticamente)
CMD ["npm", "start"]

