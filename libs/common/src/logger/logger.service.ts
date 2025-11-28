import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import * as winston from 'winston';
import { storage } from '../middleware/request-id.middleware';

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      transports: [new winston.transports.Console()],
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context, ...this.getContext() });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context, ...this.getContext() });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context, ...this.getContext() });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context, ...this.getContext() });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context, ...this.getContext() });
  }

  private getContext() {
    const store = storage.getStore();
    return store ? { requestId: store.get('requestId') } : {};
  }
}
