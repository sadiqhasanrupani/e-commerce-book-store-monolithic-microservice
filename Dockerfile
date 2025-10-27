FROM node:22

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the entire project (including apps/, libs/, etc.)
COPY . .

# Expose default port
EXPOSE 8080

# Default command - will be overridden by docker-compose
CMD ["npm", "run", "start:dev"]
