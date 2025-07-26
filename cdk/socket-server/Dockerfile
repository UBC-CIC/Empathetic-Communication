FROM node:18-alpine

WORKDIR /app

# Install Python and pip
RUN apk add --no-cache python3 py3-pip

# Install Node.js dependencies
COPY package.json ./
RUN npm install

# Copy Python files and install requirements
COPY *.py ./
COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

# Copy server files
COPY server.js ./

ENV AWS_DEFAULT_REGION=us-east-1

# Listen on HTTP port
EXPOSE 80

# Add container health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-check-certificate -qO- http://localhost:80/health || exit 1

# Install wget for healthcheck
RUN apk add --no-cache wget

# Launch your HTTP + WebSocket server
CMD ["node", "server.js"]
