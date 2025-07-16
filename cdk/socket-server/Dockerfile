FROM node:18-alpine

WORKDIR /app

# Install Python and pip
RUN apk add --no-cache python3 py3-pip

# Copy and install Node.js dependencies
COPY package.json ./
RUN npm install

# Copy Nova Sonic files
COPY *.py ./
COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

# Copy server files
COPY server.js nova_sonic.py ./

ENV AWS_DEFAULT_REGION=us-east-1

EXPOSE 3000

CMD ["npm", "start"]