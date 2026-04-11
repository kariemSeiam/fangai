FROM node:24-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

ENV NODE_OPTIONS="--experimental-strip-types"

EXPOSE 3001

ENTRYPOINT ["node", "--experimental-strip-types", "src/cli.ts"]
CMD ["wrap", "pi --mode rpc", "--port", "3001"]
