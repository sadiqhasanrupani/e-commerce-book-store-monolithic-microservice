FROM node:22

# Set working directory
WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Install nestjs cli globally
RUN npm install -g @nestjs/cli

# Copy package files first (for caching)
COPY package*.json ./

# Install dependencies using pnpm
RUN pnpm install

# Copy the rest of the project
COPY . .

# Expose NestJS default port
EXPOSE 3000

# Use pnpm to run the development server
CMD ["pnpm", "run", "start:dev"]
