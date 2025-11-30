# OpenTelemetry Tracing

This project uses OpenTelemetry (OTel) to collect and export traces to Jaeger for visualization.

## Architecture

- **Instrumentation**: The application is auto-instrumented using `@opentelemetry/auto-instrumentations-node` via `otel-bootstrap.js`.
- **Exporter**: Traces are sent via OTLP (OpenTelemetry Protocol) to a local Jaeger collector.
- **Visualization**: Jaeger UI provides a web interface to inspect traces.

## Getting Started

### 1. Start Infrastructure
Start the Jaeger collector using Docker:

```bash
docker-compose --env-file .env.development -f docker-compose.otel.yml up -d
```

This exposes:
- **UI**: [http://localhost:16686](http://localhost:16686)
- **OTLP Receiver**: `http://localhost:4318` (HTTP) and `localhost:4317` (gRPC)

### 2. Run the Application
Start the application with the OpenTelemetry bootstrap script:

```bash
npm run start:otel
```

This command sets `NODE_ENV=development` and preloads `otel-bootstrap.js`.

### 3. View Traces
1. Open [http://localhost:16686](http://localhost:16686) in your browser.
2. Select `magic-pages-api-gateway` from the **Service** dropdown.
3. Click **Find Traces**.

## Troubleshooting

### "Method Not Allowed" on localhost:4318
If you visit `http://localhost:4318/v1/traces` in your browser and see `405 Method Not Allowed`, **this is normal**.
- Port **4318** is the API endpoint for receiving traces (POST requests). It is not meant to be viewed in a browser.
- Use Port **16686** to view the Jaeger UI.

### `Resource is not a constructor` Error
If you encounter this error during startup, ensure `otel-bootstrap.js` is using `resourceFromAttributes` instead of `new Resource`. The project is configured to use the factory function compatible with the installed `@opentelemetry/resources` version.

## Configuration

The OpenTelemetry setup is defined in:
- `otel-bootstrap.js`: SDK initialization and exporter configuration.
- `docker-compose.otel.yml`: Jaeger container configuration.
