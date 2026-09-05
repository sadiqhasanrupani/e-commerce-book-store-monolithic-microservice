import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';

import { OrderItem } from '@app/contract/orders/entities/order-item.entity';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';
import { PaymentStatus } from '@app/contract/orders/enums/order-status.enum';

import { DigitalDownloadService } from './digital-download.service';
import { UploadToStorageProvider } from '../../upload/providers/upload-to-storage.provider';

const USER_ID = 7;
const ORDER_ID = 42;
const ITEM_ID = 10;

const buildItem = (overrides: any = {}): any => ({
  id: ITEM_ID,
  order: { id: ORDER_ID, payment_status: PaymentStatus.PAID },
  bookFormatVariant: {
    id: 100,
    format: BookFormat.EBOOK,
    fileUrl: 'http://minio:9000/the-magic-pages/books/123-the-book.pdf',
    book: { title: 'The Digital Book!' },
  },
  ...overrides,
});

/**
 * The authorisation chain in front of a paid book file.
 *
 * This matters more than a normal read endpoint: it is the only sanctioned way
 * to reach a paid product. Deliverables are stored with a `private` ACL, so the
 * service must hand back a credentialed *stream* — never the storage URL, and
 * never a redirect to it.
 */
describe('DigitalDownloadService', () => {
  let service: DigitalDownloadService;

  const orderItemRepository = { findOne: jest.fn() };
  const storageProvider = {
    resolveObjectKeyFromUrl: jest.fn(),
    getFile: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    storageProvider.resolveObjectKeyFromUrl.mockReturnValue('books/123-the-book.pdf');
    storageProvider.getFile.mockResolvedValue(Readable.from(['file-bytes']));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigitalDownloadService,
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepository },
        { provide: UploadToStorageProvider, useValue: storageProvider },
      ],
    }).compile();

    service = module.get<DigitalDownloadService>(DigitalDownloadService);
  });

  it('streams the file for a paid digital item owned by the caller', async () => {
    orderItemRepository.findOne.mockResolvedValue(buildItem());

    const result = await service.getDownload(USER_ID, ORDER_ID, ITEM_ID);

    expect(result.contentType).toBe('application/pdf');
    // Named after the book, not the storage key, and stripped of anything that
    // could break the Content-Disposition header.
    expect(result.filename).toBe('The-Digital-Book-ebook.pdf');
    expect(storageProvider.getFile).toHaveBeenCalledWith('books/123-the-book.pdf');
  });

  /**
   * The access mechanism itself, pinned: the buyer receives bytes read with the
   * bucket credentials, not a link to object storage. Since the deliverable is
   * stored private, anything that returned `fileUrl` to the client would hand
   * over a URL that 403s — and if the ACL ever regressed to public-read, would
   * hand over a permanent free copy.
   */
  it('returns a credentialed stream, never the storage URL', async () => {
    const item = buildItem();
    orderItemRepository.findOne.mockResolvedValue(item);

    const result = await service.getDownload(USER_ID, ORDER_ID, ITEM_ID);

    expect(result.stream).toBeInstanceOf(Readable);
    expect(JSON.stringify(Object.keys(result))).not.toContain('fileUrl');
    expect(Object.values(result)).not.toContain(item.bookFormatVariant.fileUrl);
    // The object was fetched by key through the credentialed client.
    expect(storageProvider.getFile).toHaveBeenCalledWith('books/123-the-book.pdf');
  });

  /**
   * Ownership is enforced in the WHERE clause, so someone else's item simply
   * does not come back. Asserting the query is scoped to the authenticated
   * principal is the point — a later refactor that drops the `user` filter
   * would leak every buyer's material.
   */
  it('scopes the lookup to the authenticated user', async () => {
    orderItemRepository.findOne.mockResolvedValue(buildItem());

    await service.getDownload(USER_ID, ORDER_ID, ITEM_ID);

    expect(orderItemRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: ITEM_ID,
          order: { id: ORDER_ID, user: { id: USER_ID } },
        },
      }),
    );
  });

  it('404s when the item is missing or belongs to someone else', async () => {
    orderItemRepository.findOne.mockResolvedValue(null);

    await expect(service.getDownload(USER_ID, ORDER_ID, ITEM_ID)).rejects.toThrow(NotFoundException);
    expect(storageProvider.getFile).not.toHaveBeenCalled();
  });

  it('403s when the order is not paid for', async () => {
    orderItemRepository.findOne.mockResolvedValue(
      buildItem({ order: { id: ORDER_ID, payment_status: PaymentStatus.PENDING } }),
    );

    await expect(service.getDownload(USER_ID, ORDER_ID, ITEM_ID)).rejects.toThrow(ForbiddenException);
    expect(storageProvider.getFile).not.toHaveBeenCalled();
  });

  it('404s for a physical item, which has nothing to download', async () => {
    orderItemRepository.findOne.mockResolvedValue(
      buildItem({
        bookFormatVariant: { id: 101, format: BookFormat.PAPERBACK, fileUrl: null, book: { title: 'A Paperback' } },
      }),
    );

    await expect(service.getDownload(USER_ID, ORDER_ID, ITEM_ID)).rejects.toThrow(NotFoundException);
    expect(storageProvider.getFile).not.toHaveBeenCalled();
  });

  /** Paid for, but the admin never attached a file — an operational failure. */
  it('404s when the digital variant has no usable file', async () => {
    storageProvider.resolveObjectKeyFromUrl.mockReturnValue(null);
    orderItemRepository.findOne.mockResolvedValue(buildItem());

    await expect(service.getDownload(USER_ID, ORDER_ID, ITEM_ID)).rejects.toThrow(NotFoundException);
    expect(storageProvider.getFile).not.toHaveBeenCalled();
  });
});
