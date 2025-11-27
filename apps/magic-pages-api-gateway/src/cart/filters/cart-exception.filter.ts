import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { CartErrorCode } from '@app/contract/carts/enums/cart-error-code.enum';
import { CartErrorResponse } from '@app/contract/carts/interfaces/cart-error-response.interface';

@Catch()
export class CartExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(CartExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let errorResponse: CartErrorResponse;

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse() as any;

            // Handle custom error format
            if (exceptionResponse.code && exceptionResponse.message) {
                errorResponse = {
                    success: false,
                    error: {
                        code: exceptionResponse.code,
                        message: this.getUserFriendlyMessage(exceptionResponse.code, exceptionResponse.message),
                        details: exceptionResponse.details || exceptionResponse,
                        suggestedAction: this.getSuggestedAction(exceptionResponse.code),
                    },
                };
            } else {
                // Standard HTTP exception
                errorResponse = {
                    success: false,
                    error: {
                        code: 'HTTP_ERROR',
                        message: typeof exceptionResponse === 'string' ? exceptionResponse : exceptionResponse.message,
                        suggestedAction: 'Please try again or contact support if the issue persists.',
                    },
                };
            }
        } else {
            // Unknown error
            this.logger.error('Unexpected error occurred', exception);
            errorResponse = {
                success: false,
                error: {
                    code: CartErrorCode.TRANSACTION_ROLLBACK,
                    message: 'An unexpected error occurred. Your transaction has been rolled back safely.',
                    suggestedAction: 'Please try again. If the problem persists, contact support.',
                },
            };
        }

        // Log the error for monitoring
        this.logger.error(
            `Cart error: ${errorResponse.error.code} - ${errorResponse.error.message}`,
            {
                path: request.url,
                method: request.method,
                userId: request.user?.id,
                error: exception,
            },
        );

        response.status(status).json(errorResponse);
    }

    private getUserFriendlyMessage(code: string, originalMessage: string): string {
        const messages: Record<string, string> = {
            [CartErrorCode.CART_NOT_FOUND]: 'Your cart could not be found. It may have expired or been removed.',
            [CartErrorCode.CART_EMPTY]: 'Your cart is empty. Please add items before checking out.',
            [CartErrorCode.CART_ITEM_NOT_FOUND]: 'The requested item was not found in your cart.',
            [CartErrorCode.INSUFFICIENT_STOCK]: 'Sorry, we don\'t have enough stock for this item.',
            [CartErrorCode.PAYMENT_FAILED]: 'Your payment could not be processed. Please try again.',
            [CartErrorCode.PAYMENT_TIMEOUT]: 'Payment processing timed out. Please try again.',
            [CartErrorCode.TRANSACTION_ROLLBACK]: 'The transaction was rolled back due to an error. Your cart is safe.',
            [CartErrorCode.IDEMPOTENCY_CONFLICT]: 'This request has already been processed.',
            [CartErrorCode.INVALID_CART_STATUS]: 'Your cart is in an invalid state for this operation.',
            [CartErrorCode.UNAUTHORIZED_ACCESS]: 'You do not have permission to access this cart.',
        };

        return messages[code] || originalMessage;
    }

    private getSuggestedAction(code: string): string {
        const actions: Record<string, string> = {
            [CartErrorCode.CART_NOT_FOUND]: 'Start a new cart by adding items.',
            [CartErrorCode.CART_EMPTY]: 'Browse our catalog and add items to your cart.',
            [CartErrorCode.CART_ITEM_NOT_FOUND]: 'Refresh your cart and try again.',
            [CartErrorCode.INSUFFICIENT_STOCK]: 'Please reduce the quantity or try again later.',
            [CartErrorCode.PAYMENT_FAILED]: 'Check your payment details and try again.',
            [CartErrorCode.PAYMENT_TIMEOUT]: 'Please try completing your payment again.',
            [CartErrorCode.TRANSACTION_ROLLBACK]: 'Please try your request again.',
            [CartErrorCode.IDEMPOTENCY_CONFLICT]: 'Check your order history to see if the order was already created.',
            [CartErrorCode.INVALID_CART_STATUS]: 'Please start a new cart.',
            [CartErrorCode.UNAUTHORIZED_ACCESS]: 'Please log in and try again.',
        };

        return actions[code] || 'Please try again or contact support.';
    }
}
