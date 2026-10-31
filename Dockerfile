FROM node:24-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY . .
RUN npm run build && mkdir -p /app/data && chown -R node:node /app/data /ms-playwright
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/data
USER node
EXPOSE 3001
CMD ["npm", "start"]
