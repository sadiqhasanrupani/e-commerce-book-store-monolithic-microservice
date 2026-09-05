import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Readable } from 'stream';
import * as path from 'path';

import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';
import { OrderErrorCode } from '@app/contract/orders/enums/order-error-code.enum';
import { isPhysicalFormat } from '@app/contract/books/enums/book-format.enum';

import { UploadToStorageProvider } from '../../upload/providers/upload-to-storage.provider';

/** What the controller needs to stream the file back. */
export interface DigitalDownload {
  stream: Readable;
  filename: string;
  contentType: string;
}

/** Content types we can infer from the stored object's extension. */
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.zip': 'application/zip',
};

/**
 * Serves the file behind a purchased digital order line.
 *
 * This endpoint is what the delivery e-mail ultimately leads to, and it is the
 * only sanctioned way to get at a paid book file. The e-mail deliberately does
 * NOT carry the object-storage URL, and neither does any API response: a raw
 * storage link is a permanent, infinitely forwardable handle on a paid product.
 *
 * Deliverables are now written to storage with a `private` ACL, so that link
 * would no longer resolve for an anonymous fetch either — the bytes come back
 * only through `getFile()`, which reads the object with the bucket credentials
 * *after* the checks below have passed. The response is a stream from this API,
 * never a redirect and never a URL, which keeps the authorisation decision and
 * the delivery in the same request.
 *
 * The chain below is what authorises that read.
 *
 * Authorisation is a chain, and every link is required:
 *  1. Bearer auth (controller-level `@Auth(AuthTypes.BEARER)`).
 *  2. The line belongs to an order owned by the authenticated principal —
 *     matched in the query against `order.user.id`, never against anything the
 *     client sent.
 *  3. The order is actually PAID.
 *  4. The line is a digital format.
 */
@Injectable()
export class DigitalDownloadService {
  private readonly logger = new Logger(DigitalDownloadService.name);

  constructor(
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,

    private readonly storageProvider: UploadToStorageProvider,
  ) {}

  /**
   * Resolve one order line to a readable stream of its material.
   *
   * @param userId authenticated principal's id (from the JWT, never the body)
   * @param orderId order the line must belong to
   * @param itemId the order line
   */
  async getDownload(userId: number, orderId: number, itemId: number): Promise<DigitalDownload> {
    // Ownership is enforced in the WHERE clause: the row only comes back if it
    // sits on this order AND that order belongs to this user. A line owned by
    // someone else is indistinguishable from one that does not exist.
    const item = await this.orderItemRepository.findOne({
      where: {
        id: itemId,
        order: { id: orderId, user: { id: userId } },
      },
      relations: ['order', 'bookFormatVariant', 'bookFormatVariant.book'],
    });

    if (!item) {
      this.logger.warn(`Download miss: item ${itemId} on order ${orderId} not found for user ${userId}`);
      throw new NotFoundException({ code: OrderErrorCode.ORDER_NOT_FOUND, message: 'Order item not found' });
    }

    const variant = item.bookFormatVariant;

    if (!variant || isPhysicalFormat(variant.format)) {
      // A physical book has nothing to download. 404 rather than 400: from the
      // caller's point of view there is no download resource at this path.
      throw new NotFoundException({
        code: OrderErrorCode.ORDER_NOT_FOUND,
        message: 'This item has no downloadable material',
      });
    }

    if (item.order?.payment_status !== PaymentStatus.PAID) {
      // Owned, digital, but not paid for. This is the one case that gets a 403
      // instead of a 404 — the buyer knows the order exists (it is theirs), so
      // there is nothing to conceal, and the honest reason is more useful.
      this.logger.warn(`Download refused: order ${orderId} is not paid (user ${userId})`);
      throw new ForbiddenException({
        code: OrderErrorCode.ORDER_NOT_PAID,
        message: 'This order has not been paid for yet',
      });
    }

    const key = this.storageProvider.resolveObjectKeyFromUrl(variant.fileUrl);

    if (!key) {
      // Paid for, but the admin never attached a file to the variant. That is
      // an operational problem on our side, so it is logged as an error — the
      // customer paid for something we cannot hand over.
      this.logger.error(
        `Order ${orderId} item ${itemId}: digital variant ${variant.id} has no usable fileUrl — nothing to deliver`,
      );
      throw new NotFoundException({
        code: OrderErrorCode.ORDER_NOT_FOUND,
        message: 'The material for this item is not available. Please contact support.',
      });
    }

    const stream = await this.storageProvider.getFile(key);
    const extension = path.extname(key).toLowerCase();

    return {
      stream,
      filename: this.buildFilename(variant.book?.title, variant.format, extension),
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
    };
  }

  /**
   * Name the downloaded file after the book rather than the storage key, which
   * is a timestamped uuid and means nothing to a buyer. Stripped of anything
   * that could break the `Content-Disposition` header or escape a directory.
   */
  private buildFilename(title: string | undefined, format: string, extension: string): string {
    const safeTitle = (title ?? 'download')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80);

    return `${safeTitle || 'download'}-${format}${extension}`;
  }
}
