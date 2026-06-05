FROM node:20-slim

# Instala apenas dependências base
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY pnpm-lock.yaml* ./
COPY patches ./patches

RUN npm install -g pnpm

RUN pnpm install --frozen-lockfile

RUN npx playwright install-deps chromium

COPY . .

RUN pnpm run build

RUN mkdir -p /app/connectors

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

ENV BROWSERLESS_TOKEN=2Ue4WI2dMTrp06o5369e520f2ee7f9421b6031b17b0b10a8f
ENV BUILT_IN_FORGE_API_URL=https://forge.manus.im/v1
ENV DATABASE_URL=mysql://vMrdCXY4BiAUVFo.root:4FS4WQELFcfTTLRQ@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/test
ENV JWT_SECRET=secret
ENV OAUTH_SERVER_URL=https://cfo-saas.onrender.com
ENV PLAYWRIGHT_BROWSERS_PATH=0




CMD ["sh", "-c", "pnpm run db:push 2>/dev/null || true && pnpm start"]
