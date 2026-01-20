import { CanActivate, ExecutionContext, Injectable, BadRequestException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Request key for storing validated session ID
 */
export const REQUEST_SESSION_KEY = 'sessionId';

/**
 * UUID v4 regex pattern for validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guard that validates the X-Session-Id header for guest cart operations.
 * 
 * Extracts and validates a UUID v4 session ID from the request header.
 * The session ID is stored on the request object for use by controllers/services.
 * 
 * @example
 * ```
 * @UseGuards(SessionIdGuard)
 * @Post('items')
 * async addItem(@Req() req, @Body() dto) {
 *   const sessionId = req.sessionId; // Validated UUID
 * }
 * ```
 */
@Injectable()
export class SessionIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const sessionId = this.extractSessionId(request);

    if (!sessionId) {
      throw new BadRequestException({
        code: 'MISSING_SESSION_ID',
        message: 'X-Session-Id header is required for guest cart operations',
      });
    }

    if (!this.isValidUuid(sessionId)) {
      throw new BadRequestException({
        code: 'INVALID_SESSION_ID',
        message: 'X-Session-Id must be a valid UUID v4',
      });
    }

    // Store validated session ID on request for later use
    request[REQUEST_SESSION_KEY] = sessionId;

    return true;
  }

  private extractSessionId(request: Request): string | undefined {
    return request.headers['x-session-id'] as string | undefined;
  }

  private isValidUuid(value: string): boolean {
    return UUID_V4_REGEX.test(value);
  }
}
