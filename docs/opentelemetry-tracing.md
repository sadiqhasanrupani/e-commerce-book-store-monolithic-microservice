# OpenTelemetry Tracing Setup

## Current Implementation

The cart module includes a **tracing interceptor** that logs all cart operations with timing and context information.

### Features
- ✅ Request/response timing
- ✅ User context tracking
- ✅ Operation naming (cart.addItem, cart.checkout, etc.)
- ✅ Error tracking with codes
- ✅ Success/failure status

### Example Output

```
[Trace Start] cart.addItem {
  userId: 123,
  method: 'POST',
  url: '/cart/items',
  timestamp: '2024-01-01T12:00:00.000Z'
}

[Trace Success] cart.addItem {
  userId: 123,
  duration: '45ms',
  status: 'success'
}
```

## Full OpenTelemetry Integration (Future)

To enable complete distributed tracing:

### 1. Install Dependencies

```bash
npm install @opentelemetry/api \
            @opentelemetry/sdk-node \
            @opentelemetry/auto-instrumentations-node \
            @opentelemetry/exporter-jaeger
```

### 2. Create Tracing Configuration

Create `src/tracing.ts`:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

const jaegerExporter = new JaegerExporter({
  endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
});

export const otelSDK = new NodeSDK({
  traceExporter: jaegerExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-nestjs-core': { enabled: true },
    }),
  ],
  serviceName: 'magic-pages-cart',
});
```

### 3. Initialize in main.ts

```typescript
import { otelSDK } from './tracing';

async function bootstrap() {
  // Start OpenTelemetry before app
  await otelSDK.start();
  
  const app = await NestFactory.create(AppModule);
  // ... rest of bootstrap
  
  await app.listen(3000);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  otelSDK.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});
```

### 4. Update TracingInterceptor

Replace console.log with actual spans:

```typescript
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  private tracer = trace.getTracer('cart-operations');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const request = ctx.switchToHttp().getRequest();
    const operation = this.getOperationName(request.method, request.url);

    // Create span
    const span = this.tracer.startSpan(operation, {
      attributes: {
        'user.id': request.user?.id,
        'http.method': request.method,
        'http.url': request.url,
      },
    });

    return next.handle().pipe(
      tap({
        next: () => {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        },
        error: (error) => {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          span.recordException(error);
          span.end();
        },
      }),
    );
  }
}
```

### 5. Run Jaeger (Docker)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 14268:14268 \
  jaegertracing/all-in-one:latest
```

Access UI: http://localhost:16686

### 6. Environment Variables

Add to `.env.development`:

```bash
JAEGER_ENDPOINT=http://localhost:14268/api/traces
OTEL_SERVICE_NAME=magic-pages-cart
OTEL_EXPORTER_JAEGER_AGENT_HOST=localhost
OTEL_EXPORTER_JAEGER_AGENT_PORT=6831
```

## Trace Visualization

With full OpenTelemetry, you'll see:

```
cart.checkout (150ms)
├── cart.get (10ms)
├── db.query: SELECT cart (5ms)
├── db.query: SELECT variants FOR UPDATE (8ms)
├── cart.validateStock (2ms)
├── db.query: INSERT order (12ms)
├── db.query: UPDATE stock (6ms)
├── payment.initiate (100ms)
│   └── http.post: phonepe-api (95ms)
└── cache.invalidate (3ms)
```

## Metrics to Track

### Cart Operations
- `cart.add.duration` - Time to add item
- `cart.add.success` - Success count
- `cart.add.error` - Error count
- `cart.checkout.duration` - Checkout time
- `cart.stock.insufficient` - Stock shortage count

### Database
- `db.cart.query.duration` - Query time
- `db.cart.lock.wait` - Lock wait time

### Cache
- `cache.cart.hit` - Cache hit rate
- `cache.cart.miss` - Cache miss rate

## Benefits

1. **Performance Monitoring**: See exact bottlenecks
2. **Error Tracking**: Trace errors across services
3. **User Experience**: Track end-to-end request flow
4. **Debugging**: Replay failed requests
5. **SLA Monitoring**: Track response times

## Cloud Providers

### AWS X-Ray
```bash
npm install @opentelemetry/exporter-trace-otlp-http
```

### Google Cloud Trace
```bash
npm install @google-cloud/opentelemetry-cloud-trace-exporter
```

### Azure Monitor
```bash
npm install @azure/monitor-opentelemetry-exporter
```

## Current Status

✅ Basic tracing interceptor implemented
⏳ Full OpenTelemetry integration pending
📋 Requires: Package installation + Jaeger setup
