import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

// types
import { BufferType } from '@app/contract/books/types/upload-book-file.type';
import { DeleteFilesRequest, MoveFilesRequest } from '@app/contract/storage/types/storage.type';

// providers
import { UploadToStorageProvider } from '../../upload/providers/upload-to-storage.provider';

/**
 * Book-specific façade over object storage.
 *
 * The methods here own the *key layout* for book assets (`books/...`,
 * `/books/snapshots/...`) and the error translation the books module expects;
 * the actual S3/MinIO calls live in `UploadToStorageProvider`.
 *
 * This used to talk to a separate `storage` NestJS microservice over TCP
 * (`STORAGE_PATTERN.UPLOAD` etc. on localhost:3002). That microservice has been
 * folded into the monolith, so the same provider is now injected directly. The
 * public surface of this class is deliberately unchanged — keys, returned URLs,
 * thrown exceptions and log lines are all the same as before.
 */
@Injectable()
export class UploadBookFilesProvider {
  private readonly logger = new Logger(UploadBookFilesProvider.name);

  constructor(
    /**
     * Injecting uploadToStorageProvider (in-process; formerly a ClientProxy to
     * the `storage` microservice)
     * */
    private readonly uploadToStorageProvider: UploadToStorageProvider,
  ) {} //eslint-disable-line

  /**
   * Upload multiple pdf file (from multer).
   * @param files Express Multer files
   * @returns list of URLs
   * */
  public async uploadPdfs(files: Express.Multer.File[]): Promise<string[]> {
    try {
      const urls = await Promise.all(files.map((file) => this.uploadPdf(file)));

      return urls;
    } catch (error: unknown) {
      let message = 'Unknown error';

      if (error instanceof Error) {
        message = error.message;
      }

      // Option 2: Generic HttpException (if you want custom status)
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to upload one or more PDF files',
          error: message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Upload Single pdf file (from multer).
   *
   * This is the *paid deliverable* — the file a buyer receives after paying for a
   * digital variant — so it is written `private`. Its URL is stored on
   * `book_format_varients.fileUrl` for the API's own use only: it is never handed
   * to a client, and the object behind it cannot be fetched from storage without
   * the bucket credentials. Buyers reach the bytes through
   * `GET /user/orders/:id/items/:itemId/download`, which authorises them first and
   * then streams the object.
   *
   * @param file Express Multer files
   * @returns list of URLs
   * */
  public async uploadPdf(file: Express.Multer.File): Promise<string> {
    const key = `books/${Date.now()}-${file.originalname}`;

    return await this.uploadToStorageProvider.uploadFileFromBuffer(key, file.buffer, file.mimetype, 'private');
  }

  /**
   * Upload multiple buffers (or in the sense snapshot pngs)
   *
   * These are the book cover and the preview snapshots — imagery the storefront
   * renders straight from its stored URL, so they stay publicly readable. That
   * is safe precisely because they are marketing assets, not the product.
   *
   * Visibility is left to `uploadFileFromBuffer`'s content-type default rather
   * than forced to `'public'` here, so the legacy fallback branches in
   * `books.service.ts` / `create-book.provider.ts` — which route *variant files*
   * through this method when `uploadPdfs` is unavailable — still produce a
   * private object for a PDF instead of a leaked deliverable.
   *
   * @param buffers list of objects {buffer, filename, mimetype}
   * @returns array of uploaded URLs
   * */
  public async uploadBuffers(buffers: BufferType[]) {
    try {
      /**
       * This will return the list of url when all the Promises resolved
       * */
      const urls = await Promise.all(
        buffers.map(async (b) => {
          // we need three properties
          // 1. key => url key
          // 2. filename => name of the filename
          // 3. mimetype => mimetype of the file
          const key = `/books/snapshots/${Date.now()}-${b.filename}`;

          return await this.uploadToStorageProvider.uploadFileFromBuffer(key, b.buffer, b.mimetype);
        }),
      );

      return urls;
    } catch (error: unknown) {
      let message = 'Unknown error';

      if (error instanceof Error) {
        message = error.message;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to upload snapshot images',
          error: message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Permanently deletes multiple files from the object store.
   *
   * - Fails fast if any deletion fails; logs partial errors.
   *
   * @param keys storage object keys (e.g., ['the-magic-pages/books/123.pdf'])
   */
  public async deleteObjects(keys: string[]): Promise<void> {
    if (!keys || keys.length === 0) return;

    try {
      const payload: DeleteFilesRequest = { keys };

      const response = await this.uploadToStorageProvider.deleteFiles(payload);

      if (response.failed?.length) {
        this.logger.warn(`⚠️ Some files failed to delete: ${response.failed.join(', ')}`);
      }

      this.logger.log(`🗑️ Deleted ${response.deleted?.length ?? keys.length} objects successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('❌ Failed to delete files from storage', message);
      throw new HttpException({ message: 'Storage deletion failed', error: message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Moves files to a new prefix (e.g., for archiving).
   *
   * - Performs server-side `copy → delete` for each object.
   * - Returns list of new keys or URLs.
   * - If any move fails, it logs and continues with others (best-effort).
   *
   * @param keys - original storage keys
   * @param destinationPrefix - e.g. 'archive/'
   */
  public async moveObjects(keys: string[], destinationPrefix: string): Promise<string[]> {
    if (!keys || keys.length === 0) return [];

    const results: string[] = [];

    try {
      const payload: MoveFilesRequest = {
        keys,
        destinationPrefix,
      };

      const response = await this.uploadToStorageProvider.handleMoveFiles(payload);

      if (response.moved?.length) {
        this.logger.log(`📦 Moved ${response.moved.length} files to ${destinationPrefix}`);
        results.push(...response.moved);
      }

      if (response.failed?.length) {
        this.logger.warn(`⚠️ Some files failed to move: ${response.failed.join(', ')}`);
      }

      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to move files in storage', message);
      throw new HttpException({ message: 'Storage move failed', error: message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
