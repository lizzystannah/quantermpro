FROM node:22-alpine

WORKDIR /app

# Instala as dependências
COPY package*.json ./
RUN npm install

# Copia o código e gera o build do front-end
COPY . .
RUN npm run build

# Expõe a porta 3000 (onde o servidor e o socket.io vão rodar)
EXPOSE 3000

# Comando para rodar o SERVIDOR completo (Front-end + Robôs)
CMD ["npm", "start"]
