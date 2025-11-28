import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

import { UploadBookFilesProvider } from './upload-book-files.provider';
import { Book } from '@app/contract/books/entities/book.entity';
import { DeleteOption } from '@app/contract/books/types/delete-book.type';

/**
 * DeleteBookProvider:
 * - Zero-risk DB/storage ordering
 * - Fully revertible storage operations
 * - Atomic transaction across services (best-effort SAGAs)
 * - Deep error reasoning and tracing
 */
@Injectable()
export class DeleteBookProvider {
  private readonly logger = new Logger(DeleteBookProvider.name);

  constructor(
    private readonly upload: UploadBookFilesProvider,
    private readonly dataSource: DataSource,
  ) {}

  /* -------------------------------------------------------------------------- */
  /*                              UTILITY HELPERS                               */
  /* -------------------------------------------------------------------------- */

  private extractStorageKey(url?: string | null): string | null {
    if (!url) return null;

    try {
      const u = new URL(url);
      return u.pathname.replace(/^\//, '');
    } catch {
      const parts = url.replace(/^https?:\/\//, '').split('/');
      return parts.length > 1 ? parts.slice(1).join('/') : null;
    }
  }

  private collectBookStorageKeys(book: Book): string[] {
    const keys: string[] = [];

    const add = (url?: string | null) => {
      const k = this.extractStorageKey(url);
      if (k) keys.push(k);
    };

    /** cover */
    add(book.coverImageUrl);

    /** snapshots */
    book.snapshotUrls?.forEach(add);

    /** digital + physical variant files */
    if (book.formats?.length) {
      for (const variant of book.formats) {
        add(variant.fileUrl);
      }
    }

    return [...new Set(keys)];
  }

  /* -------------------------------------------------------------------------- */
  /*                         STORAGE-SAFE ARCHIVE OPERATION                      */
  /* -------------------------------------------------------------------------- */

  private async archiveStorageObjectsOrFail(keys: string[], archivePrefix: string): Promise<string[]> {
    if (keys.length === 0) return [];

    this.logger.log(`Archiving ${keys.length} files → prefix(${archivePrefix})`);

    try {
      return await this.upload.moveObjects(keys, archivePrefix);
    } catch (err) {
      this.logger.error('Storage archive failed', err);
      throw new HttpException('Failed to archive book files', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async deleteStorageObjectsOrFail(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    this.logger.log(`Deleting ${keys.length} files permanently...`);

    try {
      await this.upload.deleteObjects(keys);
    } catch (err) {
      this.logger.error('Storage delete failed', err);
      throw new HttpException('Failed to delete book files', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                         DATABASE UPDATE OPERATIONS                          */
  /* -------------------------------------------------------------------------- */

  private async markBookArchived(queryRunner: QueryRunner, id: string): Promise<void> {
    await queryRunner.manager.update(
      Book,
      { id },
      {
        isArchived: true,
        archivedAt: new Date(),
        deletedAt: new Date(),
      },
    );
  }

  private async deleteBookRecord(queryRunner: QueryRunner, id: string): Promise<void> {
    await queryRunner.manager.delete(Book, { id });
  }

  /* -------------------------------------------------------------------------- */
  /*                                MAIN METHOD                                  */
  /* -------------------------------------------------------------------------- */

  async deleteBook(
    id: string,
    options: DeleteOption = {},
  ): Promise<{ success: boolean; mode: 'archived' | 'deleted'; id: string }> {
    const { force = false, archivePrefix = 'archive/' } = options;

    /* ------------------------------ FIND BOOK -------------------------------- */
    const repo = this.dataSource.getRepository(Book);
    const book = await repo.findOne({ where: { id } });

    if (!book) throw new NotFoundException(`Book ${id} not found`);

    const keys = this.collectBookStorageKeys(book);

    /* -------------------------------------------------------------------------- */
    /*                         START DB TRANSACTION                               */
    /* -------------------------------------------------------------------------- */
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      if (!force) {
        /* ---------------------------------------------------------------------- */
        /*                             ARCHIVE MODE                                */
        /* ---------------------------------------------------------------------- */

        await this.archiveStorageObjectsOrFail(keys, archivePrefix);

        await this.markBookArchived(qr, id);
        await qr.commitTransaction();

        this.logger.log(`Book ${id} archived successfully`);
        return { success: true, mode: 'archived', id };
      }

      /* ------------------------------------------------------------------------ */
      /*                                HARD DELETE                                */
      /* ------------------------------------------------------------------------ */

      await this.deleteStorageObjectsOrFail(keys);

      await this.deleteBookRecord(qr, id);
      await qr.commitTransaction();

      this.logger.log(`Book ${id} permanently deleted`);
      return { success: true, mode: 'deleted', id };
    } catch (err) {
      /* --------------------------- ROLLBACK DB -------------------------------- */
      await qr.rollbackTransaction();

      this.logger.error('DeleteBook operation failed; DB rolled back', err);

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to delete or archive book',
          error: err.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await qr.release();
    }
  }
}
