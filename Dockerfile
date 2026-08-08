FROM node:22-slim

# Install system ffmpeg (Debian build includes drawtext/libass/libfreetype/fontconfig)
# Also install libvips for sharp (Node.js image compositor)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fontconfig \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy full project
COPY . .

# Install custom fonts and rebuild font cache
RUN mkdir -p /usr/local/share/fonts/custom && \
    cp server/assets/fonts/*.ttf /usr/local/share/fonts/custom/ 2>/dev/null; true && \
    fc-cache -fv

EXPOSE 8080

CMD ["node", "server/server.js"]
