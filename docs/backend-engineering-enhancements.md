# Backend Engineering Enhancements - Implementation Plan

## Overview
Enhance the registration flow with production-grade reliability, resilience, and observability patterns.

## 1. ACID Principles Implementation

### Atomicity
**Goal**: Ensure user creation, OTP generation, and event emission happen as one atomic unit.

**Implementation**:
```typescript
// Use TypeORM transactions
async register(registerDto: RegisterAuthDto) {
  return await this.dataSource.transaction(async (manager) => {
    // All operations within this block are atomic
    const user = await manager.save(User, newUserData);
    const otp = await manager.save(EmailVerification, otpData);
    
    // Emit event after transaction commits
    await this.rmqClient.emit('email_verification.requested', {...});
    
    return { userId: user.id, email: user.email };
  });
}
```

### Consistency
**Goal**: Maintain data integrity across user, OTP, and email verification states.

**Implementation**:
- Database constraints (unique email, foreign keys)
- Validation at DTO level
- Status transitions (PENDING → VERIFIED → ACTIVE)

### Isolation
**Goal**: Prevent race conditions during concurrent registrations.

**Implementation**:
```typescript
// Use optimistic locking or pessimistic locking
@Entity()
export class User {
  @VersionColumn()
  version: number; // Optimistic locking
}

// Or use row-level locks
await manager.findOne(User, { 
  where: { email }, 
  lock: { mode: 'pessimistic_write' } 
});
```

### Durability
**Goal**: Ensure committed data survives system failures.

**Implementation**:
- PostgreSQL WAL (Write-Ahead Logging) - already enabled
- RabbitMQ durable queues - already configured
- Regular database backups

## 2. Retry Logic with Exponential Backoff

### RabbitMQ Connection Retry
```typescript
import { retry } from 'rxjs/operators';

async connectToRabbitMQ() {
  return await this.rmqClient.connect().pipe(
    retry({
      count: 5,
      delay: (error, retryCount) => {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        console.log(`Retry ${retryCount} after ${delay}ms`);
        return timer(delay);
      }
    })
  ).toPromise();
}
```

### Email Sending Retry
```typescript
async sendVerificationEmail(email: string, name: string, otp: string) {
  const maxRetries = 3;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      await this.transporter.sendMail({...});
      return; // Success
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) throw error;
      
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

## 3. Circuit Breaker Pattern

### Email Service Circuit Breaker
```typescript
import CircuitBreaker from 'opossum';

const emailCircuitBreaker = new CircuitBreaker(
  async (email, name, otp) => {
    return await this.mailService.sendVerificationEmail(email, name, otp);
  },
  {
    timeout: 10000, // 10 seconds
    errorThresholdPercentage: 50,
    resetTimeout: 30000, // 30 seconds
    rollingCountTimeout: 60000, // 1 minute window
  }
);

emailCircuitBreaker.on('open', () => {
  console.error('Circuit breaker opened - email service is down');
});

emailCircuitBreaker.on('halfOpen', () => {
  console.log('Circuit breaker half-open - testing email service');
});
```

## 4. Timeout Handling

### Request-Level Timeout
```typescript
@Post('register')
@Timeout(30000) // 30 second timeout
async register(@Body() dto: RegisterAuthDto) {
  // Implementation
}
```

### Database Query Timeout
```typescript
// In TypeORM connection options
{
  extra: {
    statement_timeout: 10000, // 10 seconds
    query_timeout: 10000
  }
}
```

### RabbitMQ Message Timeout
```typescript
this.rmqClient.emit('email_verification.requested', data, {
  expiration: '60000', // 60 seconds TTL
});
```

## 5. Distributed Tracing

### OpenTelemetry Integration
```typescript
import { trace } from '@opentelemetry/api';

async register(dto: RegisterAuthDto) {
  const tracer = trace.getTracer('auth-service');
  
  return await tracer.startActiveSpan('user.register', async (span) => {
    span.setAttribute('user.email', dto.email);
    
    try {
      const user = await this.createUser(dto);
      span.setAttribute('user.id', user.id);
      
      await this.generateOtp(user);
      await this.emitEmailEvent(user);
      
      span.setStatus({ code: SpanStatusCode.OK });
      return user;
    } catch (error) {
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error.message 
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

## 6. Dead Letter Queue (DLQ)

### RabbitMQ DLQ Configuration
```typescript
// In RmqModule
{
  queueOptions: {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': 'dlx.magic-pages',
      'x-dead-letter-routing-key': 'email.failed',
      'x-message-ttl': 300000, // 5 minutes
      'x-max-retries': 3,
    }
  }
}
```

### DLQ Consumer
```typescript
@Controller()
export class EmailDLQConsumer {
  @EventPattern('email.failed')
  async handleFailedEmail(@Payload() data: any) {
    // Log to monitoring system
    // Store in database for manual retry
    // Send alert to ops team
  }
}
```

## 7. Rate Limiting

### Per-User Rate Limiting
```typescript
import { ThrottlerGuard } from '@nestjs/throttler';

@UseGuards(ThrottlerGuard)
@Throttle(5, 3600) // 5 requests per hour
@Post('register')
async register(@Body() dto: RegisterAuthDto) {
  // Implementation
}
```

### Redis-Based Rate Limiting
```typescript
async checkRateLimit(email: string): Promise<boolean> {
  const key = `rate_limit:register:${email}`;
  const count = await this.redis.incr(key);
  
  if (count === 1) {
    await this.redis.expire(key, 3600); // 1 hour
  }
  
  return count <= 5; // Max 5 registrations per hour
}
```

## 8. Graceful Degradation

### Registration Succeeds Even if Email Fails
```typescript
async register(dto: RegisterAuthDto) {
  // Always succeed user creation
  const user = await this.createUser(dto);
  const otp = await this.generateOtp(user);
  
  // Email sending is best-effort
  try {
    await this.emitEmailEvent(user, otp);
  } catch (error) {
    // Log error but don't fail registration
    this.logger.error('Failed to send email', error);
    
    // Store for retry
    await this.queueForRetry(user.id, otp);
  }
  
  return {
    message: 'User registered. Check email for verification code.',
    userId: user.id,
    email: user.email
  };
}
```

## 9. Health Checks

### RabbitMQ Health Check
```typescript
@Controller('health')
export class HealthController {
  @Get('rabbitmq')
  async checkRabbitMQ() {
    try {
      await this.rmqClient.send('health.check', {}).toPromise();
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: error.message };
    }
  }
}
```

### Database Health Check
```typescript
@Get('database')
async checkDatabase() {
  try {
    await this.dataSource.query('SELECT 1');
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', error: error.message };
  }
}
```

## 10. Saga Pattern for Distributed Transaction

### Registration Saga
```typescript
class RegistrationSaga {
  async execute(dto: RegisterAuthDto) {
    const compensations = [];
    
    try {
      // Step 1: Create user
      const user = await this.createUser(dto);
      compensations.push(() => this.deleteUser(user.id));
      
      // Step 2: Generate OTP
      const otp = await this.generateOtp(user);
      compensations.push(() => this.deleteOtp(otp.id));
      
      // Step 3: Send email
      await this.sendEmail(user, otp);
      
      return { success: true, user };
    } catch (error) {
      // Rollback in reverse order
      for (const compensate of compensations.reverse()) {
        await compensate();
      }
      throw error;
    }
  }
}
```

## Implementation Priority

1. **High Priority** (Production Critical):
   - ✅ Database transactions (ACID)
   - ✅ Timeout handling
   - ✅ Graceful degradation
   - ✅ Health checks

2. **Medium Priority** (Reliability):
   - ⚠️ Retry logic with exponential backoff
   - ⚠️ Circuit breaker for email service
   - ⚠️ Dead letter queue

3. **Low Priority** (Optimization):
   - 📝 Distributed tracing enhancements
   - 📝 Advanced rate limiting
   - 📝 Saga pattern implementation

## Testing Strategy

1. **Unit Tests**: Test retry logic, circuit breaker states
2. **Integration Tests**: Test transaction rollback, timeout handling
3. **Chaos Engineering**: Simulate RabbitMQ failures, database slowness
4. **Load Testing**: Verify rate limiting, connection pooling

## Monitoring & Alerts

- **Metrics**: Registration success/failure rate, email delivery rate
- **Alerts**: Circuit breaker open, DLQ message count > threshold
- **Dashboards**: Registration funnel, error rates by type
