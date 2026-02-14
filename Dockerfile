FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY src/ ./src/
COPY api/ ./api/

EXPOSE 3000

CMD ["node", "src/app.js"]
