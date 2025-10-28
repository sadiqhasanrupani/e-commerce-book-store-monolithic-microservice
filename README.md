# Magic Pages - E-Commerce Book Store Backend

A NestJS-based monolithic architecture for an e-commerce book store platform. This project uses a modular monorepo structure with multiple applications (API Gateway, Books Service, and Storage Service) for different business domains.

## 📋 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [Running the Application](#running-the-application)
- [Available Microservices](#available-microservices)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## 🏗️ Architecture Overview

This project follows a modular monolithic architecture with the following components:

- **API Gateway**: Main entry point for all client requests, handles authentication, user management, and routing
- **Books Service**: Manages book catalog, inventory, and book-related operations
- **Storage Service**: Handles file uploads and storage using MinIO (S3-compatible storage)
- **Shared Libraries**:
  - **Contract Library**: Shared DTOs, interfaces, and patterns across applications
  - **Database Library**: TypeORM configurations and database utilities
  - **Global Config**: Environment configuration and validation schemas

## ✅ Prerequisites

Before starting this project, ensure you have the following installed on your system:

### Required Software

1. **Node.js** (v22 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version`

2. **pnpm** (Package Manager)
   - Install globally: `npm install -g pnpm`
   - Verify installation: `pnpm --version`

3. **Docker Desktop** (Required for running services)
   - Download from [docker.com](https://www.docker.com/products/docker-desktop)
   - Ensure Docker Compose is included
   - Verify installation: `docker --version` and `docker-compose --version`

4. **PostgreSQL Client** (Optional, for direct database access)
   - Included in Docker setup
   - For local development: Download from [postgresql.org](https://www.postgresql.org/download/)

5. **NestJS CLI** (Optional, for development)
   - Install globally: `npm install -g @nestjs/cli`
   - Verify installation: `nest --version`

### System Requirements

- **OS**: Windows 10/11, macOS, or Linux
- **RAM**: Minimum 8GB (16GB recommended for running all services)
- **Disk Space**: At least 5GB free space
- **Network**: Internet connection for downloading dependencies

## 📁 Project Structure

```
.
├── apps/                          # Application modules
│   ├── books/                     # Books catalog service
│   ├── magic-pages-api-gateway/   # API Gateway (main application)
│   │   ├── src/
│   │   │   ├── auth/              # Authentication module
│   │   │   ├── books/             # Books proxy module
│   │   │   ├── upload/            # File upload module
│   │   │   └── users/             # Users module
│   └── storage/                   # File storage service
├── libs/                          # Shared libraries
│   ├── contract/                  # Shared DTOs, interfaces, and patterns
│   ├── database/                  # Database configurations (TypeORM)
│   └── global-config/             # Global configurations and env schemas
├── docker-compose.yaml            # Docker services definition
├── Dockerfile                     # Container image definition
├── package.json                   # Project dependencies
└── README.md                      # This file
```

## 🚀 Getting Started

Follow these steps to set up and run the project:

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd e-commerce-book-store-monolithic-microservice
```

### Step 2: Install Dependencies

Install all project dependencies using pnpm:

```bash
pnpm install
```

This will install all dependencies for the main project and all microservices.

### Step 3: Set Up Environment Variables

Create environment configuration files for each service that requires them:

1. **Create `.env` file in the root directory** (if not exists):

```bash
# Node Environment
NODE_ENV=development

# Database Configuration
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres123
DATABASE_NAME=magic-pages
DATABASE_SYNC=true
DATABASE_AUTOLOAD=true

# MinIO Storage Configuration
STORAGE_ENDPOINT=localhost
STORAGE_PORT=9000
STORAGE_ACCESS_KEY=minio
STORAGE_SECRET_KEY=minio123
STORAGE_BUCKET=the-magic-pages
STORAGE_USE_SSL=false
STORAGE_REGION=us-east-1

# Application Ports
PORT=3000
BOOKS_PORT=3001
STORAGE_PORT=3002
```

2. **Important**: Make sure to update these values for production environments with secure passwords and proper endpoints.

### Step 4: Start Docker Services

Start PostgreSQL and MinIO services using Docker Compose:

```bash
docker-compose up -d postgres minio
```

This will start:
- **PostgreSQL** on port `5432`
- **MinIO** on port `9000` (API) and `9001` (Console)

Verify services are running:

```bash
docker-compose ps
```

### Step 5: Set Up Database

The database will be automatically created by PostgreSQL. If you need to run migrations or seed data:

```bash
# Run migrations (if available)
pnpm run migration:run

# Seed database (if available)
pnpm run seed
```

### Step 6: Set Up MinIO Bucket

1. Access MinIO Console at: `http://localhost:9001`
2. Login with credentials:
   - Username: `minio`
   - Password: `minio123`
3. Create a bucket named: `the-magic-pages`
4. Set bucket policy to public (if needed for public access)

## 🔧 Environment Configuration

### Required Environment Variables

Each microservice may require specific environment variables. Here's a comprehensive list:

#### Database Configuration
```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres123
DATABASE_NAME=magic-pages
DATABASE_SYNC=true
DATABASE_AUTOLOAD=true
```

#### Storage Configuration (MinIO)
```env
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_PORT=9000
STORAGE_ACCESS_KEY=minio
STORAGE_SECRET_KEY=minio123
STORAGE_BUCKET=the-magic-pages
STORAGE_USE_SSL=false
STORAGE_REGION=region
```

#### Application Configuration
```env
NODE_ENV=development
PORT=3000
API_GATEWAY_PORT=3000
BOOKS_SERVICE_PORT=3001
STORAGE_SERVICE_PORT=3002
```

#### Authentication Configuration (Add if needed)
```env
JWT_SECRET=your-secret-key-here
JWT_EXPIRATION=3600
```

#### Email Configuration (Add if needed)
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

## 🏃 Running the Application

### Option 1: Run with Docker Compose (Recommended)

Run all services together:

```bash
docker-compose up
```

Run specific services:

```bash
docker-compose up gateway books storage
```

Run in detached mode:

```bash
docker-compose up -d
```

### Option 2: Run Locally (Development)

1. **Start infrastructure services** (PostgreSQL and MinIO):
```bash
docker-compose up -d postgres minio
```

2. **Run the API Gateway** (includes auth and user management):
```bash
pnpm run start:dev
```

3. **Run individual services** (in separate terminals):
```bash
# Books Service
pnpm run books:dev

# Storage Service
pnpm run storage:dev
```

### Debug Mode

Run services in debug mode for debugging with breakpoints:

```bash
# API Gateway in debug mode
pnpm run start:debug

# Books Service in debug mode
pnpm run books:debug

# Storage Service in debug mode
pnpm run storage:debug
```

### Option 3: Run in Production Mode

```bash
# Build all services
pnpm run build

# Start in production mode
pnpm run start:prod
```

## 📦 Available Applications

| Application | Port | Description | Endpoint |
|-------------|------|-------------|----------|
| API Gateway | 3000 | Main application with auth, users, and routing | http://localhost:3000 |
| Books Service | 3001 | Book catalog and inventory management | http://localhost:3001 |
| Storage Service | 3002 | File storage and upload handling | http://localhost:3002 |
| PostgreSQL | 5432 | Database | localhost:5432 |
| MinIO API | 9000 | Object storage API | http://localhost:9000 |
| MinIO Console | 9001 | Storage admin interface | http://localhost:9001 |

## 📚 API Documentation

Once the application is running, you can access the API documentation:

- **Swagger UI**: `http://localhost:3000/api` (API Gateway)
- **Books API**: `http://localhost:3001/api`
- **Storage API**: `http://localhost:3002/api`

## 🛠️ Development

### Available Scripts

```bash
# Development - Start API Gateway with hot reload
pnpm run start:dev

# Development - Start Books Service with hot reload
pnpm run books:dev

# Development - Start Storage Service with hot reload
pnpm run storage:dev

# Debug mode - API Gateway
pnpm run start:debug

# Debug mode - Books Service
pnpm run books:debug

# Debug mode - Storage Service
pnpm run storage:debug

# Production - Start API Gateway
pnpm run start

# Production - Start Books Service
pnpm run books

# Production - Start Storage Service
pnpm run storage

# Build the project
pnpm run build

# Lint code
pnpm run lint

# Format code
pnpm run format

# Run tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run test coverage
pnpm run test:cov

# Run e2e tests
pnpm run test:e2e
```

### Adding a New Module

```bash
# Generate a new module in API Gateway
nest g module <module-name> apps/magic-pages-api-gateway

# Generate a new controller
nest g controller <module-name> apps/magic-pages-api-gateway

# Generate a new service
nest g service <module-name> apps/magic-pages-api-gateway
```

### Adding a New Application

```bash
# Generate a new application
nest g app <app-name>
```

### Code Style

This project uses:
- **ESLint** for linting
- **Prettier** for code formatting

Run before committing:
```bash
pnpm run lint
pnpm run format
```

## 🧪 Testing

### Run Unit Tests

```bash
pnpm run test
```

### Run E2E Tests

```bash
pnpm run test:e2e
```

### Run Tests with Coverage

```bash
pnpm run test:cov
```

## 🔍 Troubleshooting

### Common Issues and Solutions

#### 1. Docker Services Not Starting

**Issue**: PostgreSQL or MinIO container fails to start

**Solution**:
```bash
# Stop all containers
docker-compose down

# Remove volumes and restart
docker-compose down -v
docker-compose up -d postgres minio
```

#### 2. Port Already in Use

**Issue**: `Error: listen EADDRINUSE: address already in use :::3000`

**Solution**:
```bash
# Find and kill the process using the port (Windows PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process

# Or change the port in your environment variables
```

#### 3. Database Connection Error

**Issue**: Cannot connect to PostgreSQL

**Solution**:
- Verify PostgreSQL is running: `docker-compose ps`
- Check DATABASE_URL in .env file
- Ensure PostgreSQL port 5432 is not blocked
- Restart PostgreSQL container: `docker-compose restart postgres`

#### 4. MinIO Connection Error

**Issue**: Cannot connect to MinIO storage

**Solution**:
- Verify MinIO is running: `docker-compose ps`
- Access MinIO console: `http://localhost:9001`
- Check credentials in .env file
- Ensure bucket `the-magic-pages` exists
- Restart MinIO: `docker-compose restart minio`

#### 5. Dependencies Installation Failed

**Issue**: `pnpm install` fails

**Solution**:
```bash
# Clear pnpm cache
pnpm store prune

# Remove node_modules and lock file
rm -rf node_modules pnpm-lock.yaml

# Reinstall
pnpm install
```

#### 6. Module Not Found Errors

**Issue**: Cannot find module '@app/config' or similar

**Solution**:
```bash
# Rebuild the project
pnpm run build

# Or restart the development server
pnpm run start:dev
```

### Checking Service Health

```bash
# Check all Docker containers
docker-compose ps

# View logs for API Gateway
pnpm run start:dev

# View logs for a specific Docker service
docker-compose logs -f <service-name>

# Example: View PostgreSQL logs
docker-compose logs -f postgres

# Example: View MinIO logs
docker-compose logs -f minio
```

### Accessing Services

- **API Gateway**: `http://localhost:3000`
- **Books Service**: `http://localhost:3001`
- **Storage Service**: `http://localhost:3002`
- **PostgreSQL**: `postgresql://postgres:postgres123@localhost:5432/magic-pages`
- **MinIO Console**: `http://localhost:9001` (user: minio, password: minio123)
- **MinIO API**: `http://localhost:9000`

## 📝 Important Notes

1. **Before Starting Development**:
   - Ensure Docker Desktop is running
   - Start PostgreSQL and MinIO services first
   - Create the MinIO bucket manually
   - Set up all required environment variables

2. **For Production**:
   - Use strong passwords for all services
   - Enable SSL/TLS for all connections
   - Set NODE_ENV=production
   - Use proper secret management
   - Configure proper CORS settings
   - Set up monitoring and logging

3. **Data Persistence**:
   - PostgreSQL data is stored in `./postgres-data` (ignored by git)
   - MinIO data is stored in `./minio-data` (ignored by git)
   - **Do not delete these folders** unless you want to reset data
   - These directories are excluded from version control

4. **WSL Users** (Windows Subsystem for Linux):
   - The project path shows WSL structure
   - Ensure Docker Desktop has WSL integration enabled
   - File permissions may need adjustment

## 📧 Support

For issues and questions:
- Check the troubleshooting section above
- Review Docker and service logs
- Check NestJS documentation: https://docs.nestjs.com/

## 📄 License

This project is licensed under UNLICENSED.

---

**Happy Coding! 🚀**
