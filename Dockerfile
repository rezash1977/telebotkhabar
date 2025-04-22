FROM ghcr.io/puppeteer/puppeteer:21.7.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /usr/src/app

# Change ownership to pptruser
USER root
RUN chown -R pptruser:pptruser /usr/src/app
USER pptruser

# Install dependencies
COPY --chown=pptruser:pptruser package*.json ./
RUN npm install --production

# Copy app source
COPY --chown=pptruser:pptruser . .

# Start the bot
CMD ["npm", "start"] 