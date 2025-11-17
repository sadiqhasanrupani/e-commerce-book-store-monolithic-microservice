import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// entities
import { Book } from '@app/contract/books/entities/book.entity';

// providers
import { UploadBookFilesProvider } from './upload-book-files.provider';

// types
import { DeleteOption } from '@app/contract/books/types/delete-book.type';

@Injectable()
export class DeleteBookProvider {
  private readonly logger = new Logger(DeleteBookProvider.name);

  constructor(
    private readonly uploadBookFilesProvider: UploadBookFilesProvider,
    private readonly dataSource: DataSource,
  ) { } // eslint-disable-line

  /**
   * Extracts the storage object key from a full URL.
   * For example:
   *  - http://localhost:9000/the-magic-pages/books/abc.pdf -> the-magic-pages/books/abc.pdf
   *  - https://cdn.example.com/books/abc.pdf -> books/abc.pdf (if bucket not encoded)
   *
   * This function tries to be robust but you should adapt it to your URL patterns.
   *
   * @param url - the full URL stored in DB
   * @returns storage key or null if it cannot be extracted
   */
  private extractStorageKeyFromUrl(url?: string | null): string | null {
    if (!url) return null;
    try {
      const u = new URL(url);
      // path without leading slash
      const path = u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
      // if host contains bucket name as first segment (MinIO default), return path
      // e.g. /the-magic-pages/books/abc.pdf -> the-magic-pages/books/abc.pdf
      return path;
    } catch {
      // fallback: simple split
      const idx = url.indexOf('://');
      const cleaned = idx !== -1 ? url.slice(idx + 3) : url;
      const parts = cleaned.split('/');
      // drop host segment
      if (parts.length > 1) return parts.slice(1).join('/');
      return null;
    }
  }

  /**
   * Deletes (or archives) a book and associated files.
   *
   * Default behavior: archive files to an `archivePrefix` (safe).
   * If options.force === true, perform a hard delete (remove files from storage and delete DB record).
   *
   * Steps:
   *  - Find book by id
   *  - Gather storage keys (coverImageUrl, snapshotUrls[], bookFileUrls[])
   *  - If archiving: call storage provider to move objects to archive prefix
   *  - If hard deleting: call storage provider to delete objects
   *  - Start DB transaction:
   *      - For archive: set isArchived = true, archivedAt = now, optionally set deletedAt if needed
   *      - For hard delete: remove DB record
   *  - Commit transaction
   *
   * @param id - book id
   * @param options - Delete option
   * @returns a result object describing the final state
   */
  async deleteBook(
    id: number,
    options: DeleteOption = {},
  ): Promise<{ success: boolean; mode: 'archived' | 'deleted'; id: number }> {
    const { force = false, archivePrefix = 'archive/' } = options;

    // find book
    const book = await this.dataSource.getRepository(Book).findOneBy({ id });
    if (!book) {
      throw new NotFoundException(`Book with ID ${id} not found`);
    }

    // gather storage keys
    const keysToProcess: string[] = [];

    const coverKey = this.extractStorageKeyFromUrl(book.coverImageUrl ?? null);
    if (coverKey) keysToProcess.push(coverKey);

    if (book.snapshotUrls?.length) {
      for (const url of book.snapshotUrls) {
        const k = this.extractStorageKeyFromUrl(url);
        if (k) keysToProcess.push(k);
      }
    }

    if (book.bookFileUrls?.length) {
      for (const url of book.bookFileUrls) {
        const k = this.extractStorageKeyFromUrl(url);
        if (k) keysToProcess.push(k);
      }
    }

    // remove duplicates
    const uniqueKeys = Array.from(new Set(keysToProcess));

    // If nothing to do in storage, still proceed with DB change
    try {
      if (!force) {
        // Archive mode: move files to archive prefix
        if (uniqueKeys.length > 0) {
          // moveObjects should return an array of new URLs or keys, depending on provider design
          // provider should be implemented to accept (keys, destinationPrefix)
          await this.uploadBookFilesProvider.moveObjects(uniqueKeys, archivePrefix);
        }

        // DB transaction: mark archived
        const queryRunner: QueryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          const update: Partial<Book> = {
            isArchived: true,
            archivedAt: new Date(),
            deletedAt: new Date(),
          };

          await queryRunner.manager.update(Book, { id }, update);
          await queryRunner.commitTransaction();

          this.logger.log(`Book ${id} archived (files moved to ${archivePrefix}).`);
          return { success: true, mode: 'archived', id };
        } catch (dbErr) {
          await queryRunner.rollbackTransaction();
          // Attempt rollback of move: best-effort: try to move files back
          try {
            if (uniqueKeys.length > 0) {
              // if moveObjects accepted keys and dest prefix, need a way to compute archive keys and original keys to revert.
              // Attempting revert only if provider offers revert or copy-back; if not, log and escalate.
              await this.uploadBookFilesProvider.moveObjects(
                uniqueKeys.map((k) => `${archivePrefix}${k}`),
                '', // move back to root (implementation-dependent)
              );
            }
          } catch (revertErr) {
            this.logger.error('Failed to revert archive after DB rollback', revertErr);
          }

          this.logger.error('Failed to mark book archived', dbErr);
          throw new HttpException(
            {
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              message: 'Failed to archive book',
              error: (dbErr as Error).message,
            },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        } finally {
          await queryRunner.release();
        }
      } else {
        // Force hard delete: delete files from storage then remove DB row
        if (uniqueKeys.length > 0) {
          await this.uploadBookFilesProvider.deleteObjects(uniqueKeys);
        }

        // DB transaction: delete row
        const queryRunner: QueryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          await queryRunner.manager.delete(Book, { id });
          await queryRunner.commitTransaction();
          this.logger.log(`Book ${id} hard-deleted (files removed).`);
          return { success: true, mode: 'deleted', id };
        } catch (dbErr) {
          await queryRunner.rollbackTransaction();
          this.logger.error('Failed to delete book record after storage deletion', dbErr);
          // NOTE: at this point, files may already be deleted. Consider raising an alert so ops can recover DB.
          throw new HttpException(
            {
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              message: 'Failed to delete book record',
              error: (dbErr as Error).message,
            },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        } finally {
          await queryRunner.release();
        }
      }
    } catch (storageErr) {
      // Storage operation failed — do not change DB
      this.logger.error('Storage operation failed during delete/archive', storageErr);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Storage operation failed',
          error: (storageErr as Error).message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
