import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

// patterns
import { STORAGE_PATTERN } from '@app/contract/storage/patterns/storage.pattern';

// types
import { BufferType } from '@app/contract/books/types/upload-book-file.type';
import { UploadFileRequest, UploadFileResponse } from '@app/contract/books/types/storage.type';
import { STORAGE_CONFIG } from '@app/contract/storage/configs/storage.config';
import {
  DeleteFilesRequest,
  DeleteFilesResponse,
  MoveFilesRequest,
  MoveFilesResponse,
} from '@app/contract/storage/types/storage.type';

@Injectable()
export class UploadBookFilesProvider {
  private readonly logger = new Logger(UploadBookFilesProvider.name);
  constructor(
    /**
     * Injecting storageClient
     * */
    @Inject(STORAGE_CONFIG.CLIENTS.name)
    private readonly storageClient: ClientProxy,
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
   * @param file Express Multer files
   * @returns list of URLs
   * */
  public async uploadPdf(file: Express.Multer.File): Promise<string> {
    const payload: UploadFileRequest = {
      key: `books/${Date.now()}-${file.originalname}`,
      // fileBuffer: file.buffer.toString('base64'),
      fileBuffer: file.buffer,
      contentType: file.mimetype,
    };

    const response = await firstValueFrom(
      this.storageClient.send<UploadFileResponse, UploadFileRequest>(STORAGE_PATTERN.UPLOAD, payload),
    );

    return response.url;
  }

  /**
   * Upload multiple buffers (or in the sense snapshot pngs)
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
          const payload: UploadFileRequest = {
            key: `/books/snapshots/${Date.now()}-${b.filename}`,
            fileBuffer: b.buffer,
            contentType: b.mimetype,
          };

          const resp = await firstValueFrom(
            this.storageClient.send<UploadFileResponse, UploadFileRequest>(STORAGE_PATTERN.UPLOAD, payload),
          );

          return resp.url;
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
   * - If integrated with the storage microservice, this triggers `STORAGE_PATTERN.DELETE`.
   * - Fails fast if any deletion fails; logs partial errors.
   *
   * @param keys storage object keys (e.g., ['the-magic-pages/books/123.pdf'])
   */
  public async deleteObjects(keys: string[]): Promise<void> {
    if (!keys || keys.length === 0) return;

    try {
      const payload: DeleteFilesRequest = { keys };

      const response = await firstValueFrom(
        this.storageClient.send<DeleteFilesResponse, DeleteFilesRequest>(STORAGE_PATTERN.DELETE, payload),
      );

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

      const response = await firstValueFrom(
        this.storageClient.send<MoveFilesResponse, MoveFilesRequest>(STORAGE_PATTERN.MOVE, payload),
      );

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
