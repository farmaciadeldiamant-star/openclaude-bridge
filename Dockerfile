# Stage 1: Builder
FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json ./

# Install the claude-code CLI locally
RUN npm install @anthropic-ai/claude-code --omit=dev

# Stage 2: Runtime
FROM node:18-alpine

WORKDIR /app

# git is often required by claude-code for repository context
RUN apk add --no-cache git

COPY --from=builder /app/node_modules ./node_modules
COPY package.json bridge.mjs ./

# Point the bridge directly to the installed CLI and configure defaults
ENV CLAUDE_CLI=/app/node_modules/@anthropic-ai/claude-code/cli.js
ENV OPENCLAUDE_HOST=0.0.0.0
ENV OPENCLAUDE_PORT=8788

EXPOSE 8788

# Use an unprivileged user if you prefer, but mounting ~/.claude:ro 
# is easiest when running as root, matching the host's volume.
CMD ["node", "bridge.mjs"]
