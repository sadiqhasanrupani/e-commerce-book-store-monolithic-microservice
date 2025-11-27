import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * OpenTelemetry tracing interceptor for cart operations
 * Tracks request duration, user context, and operation outcomes
 * 
 * To enable full OpenTelemetry:
 * 1. Install: npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
 * 2. Configure exporter (Jaeger, Zipkin, or cloud provider)
 * 3. Initialize in main.ts
 */
@Injectable()
export class TracingInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const { method, url, user } = request;
        const startTime = Date.now();

        // Extract operation name from route
        const operation = this.getOperationName(method, url);

        // Log trace start (in production, this would create an OpenTelemetry span)
        console.log(`[Trace Start] ${operation}`, {
            userId: user?.id,
            method,
            url,
            timestamp: new Date().toISOString(),
        });

        return next.handle().pipe(
            tap({
                next: (data) => {
                    const duration = Date.now() - startTime;

                    // Log successful trace (in production, this would end the span with success)
                    console.log(`[Trace Success] ${operation}`, {
                        userId: user?.id,
                        duration: `${duration}ms`,
                        status: 'success',
                    });
                },
                error: (error) => {
                    const duration = Date.now() - startTime;

                    // Log error trace (in production, this would end the span with error)
                    console.error(`[Trace Error] ${operation}`, {
                        userId: user?.id,
                        duration: `${duration}ms`,
                        status: 'error',
                        errorCode: error.response?.code || error.status,
                        errorMessage: error.message,
                    });
                },
            }),
        );
    }

    private getOperationName(method: string, url: string): string {
        // Extract meaningful operation name from URL
        if (url.includes('/cart/checkout')) return 'cart.checkout';
        if (url.includes('/cart/clear')) return 'cart.clear';
        if (url.includes('/cart/items') && method === 'POST') return 'cart.addItem';
        if (url.includes('/cart/items') && method === 'PUT') return 'cart.updateItem';
        if (url.includes('/cart/items') && method === 'DELETE') return 'cart.removeItem';
        if (url.includes('/cart') && method === 'GET') return 'cart.get';

        return `cart.${method.toLowerCase()}`;
    }
}
