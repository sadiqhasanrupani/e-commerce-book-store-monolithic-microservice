import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UpdateBookDto } from '@app/contract/books/dtos/update-book.dto';

import { CreateBookProvider } from './create-book.provider';
import { UploadBookFilesProvider } from './upload-book-files.provider';

import { CreateBookData } from '@app/contract/books/types/book.type';
import { DataSource, QueryRunner, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

import { Book } from '@app/contract/books/entities/book.entity';
import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { DeleteBookProvider } from './delete-book.provider';
import { DeleteOption } from '@app/contract/books/types/delete-book.type';
import { FindAllBookQueryParam, FindAllBookResponse, FindOneBookOption } from '@app/contract/books/types/find-book.type';
import { FindBookProvider } from './find-book.provider';

/**
 * Service responsible for handling all book-related operations,
 * including bulk creation with full transactional safety.
 */
@Injectable()
export class BooksService {
  private readonly logger = new Logger(BooksService.name);
  /**
   * Injecting the Book repository to interact with the database.
   */
  constructor(
    /**
     * Injecting createBookProvider
     * */
    private readonly createBookProvider: CreateBookProvider,

    /**
     * Injecting uploadBookFilesProvider
     * */
    private readonly uploadBookFilesProvider: UploadBookFilesProvider,

    /**
     * Inject deleteBookProvider
     * */
    private readonly deleteBookProvider: DeleteBookProvider,

    /**
     * Inject userRepository
     * */
    @InjectRepository(Book)
    private readonly bookRepository: Repository<Book>,

    /**
     * Inject dataSource
     * */
    private readonly dataSource: DataSource,

    /**
     * Inject findBookProvider
     * */
    private readonly findBookProvider: FindBookProvider,

  ) { } //eslint-disable-line

  /**
   * Create a new book entry in the database.
   * Uploads the book image via Storage microservice if provided.
   *
   * @param data - Partial data for the new book. Can include any subset of the Book entity fields.
   * @param file - Optional file object containing buffer, filename, mimetype
   * @returns The created Book entity.
   */
  async create(data: CreateBookData): Promise<Book> {
    try {
      const { createBookDto, files } = data;

      // Prepare URL placeholders
      let bookFileUrls: string[] = [];
      let snapshotUrls: string[] = [];
      let coverImageUrl: string | null = null;

      /**
       * 1️⃣ Upload the main book file (PDF, Excel, etc.)
       */
      if (files?.file) {
        // The "file" field can be single or array, normalize to array
        const fileList = Array.isArray(files.file) ? files.file : [files.file];
        bookFileUrls = await this.uploadBookFilesProvider.uploadPdfs(fileList);
      }

      /**
       * 2️⃣ Upload the cover image (bookCover)
       */
      if (files?.bookCover) {
        const coverFile = Array.isArray(files.bookCover)
          ? files.bookCover[0]
          : files.bookCover;

        const coverPayload = [
          {
            buffer: coverFile.buffer,
            filename: coverFile.originalname,
            mimetype: coverFile.mimetype,
          },
        ];

        const [uploadedCoverUrl] = await this.uploadBookFilesProvider.uploadBuffers(
          coverPayload,
        );

        coverImageUrl = uploadedCoverUrl;
      }

      /**
       * 3️⃣ Upload snapshot images (snapshots)
       */
      if (files?.snapshots?.length) {
        const snapshotPayload = files.snapshots.map((file) => ({
          buffer: file.buffer,
          filename: file.originalname,
          mimetype: file.mimetype,
        }));

        snapshotUrls = await this.uploadBookFilesProvider.uploadBuffers(
          snapshotPayload,
        );
      }

      /**
       * 4️⃣ Merge all data into a final CreateBookDto
       */
      const completeBookData: CreateBookDto = {
        ...createBookDto,
        coverImageUrl,
        bookFileUrls,
        snapshotUrls,
        // Provide default flags if not passed
        isBestseller: createBookDto.isBestseller ?? false,
        isFeatured: createBookDto.isFeatured ?? false,
        isNewRelease: createBookDto.isNewRelease ?? false,
        allowReviews: createBookDto.allowReviews ?? true,
        allowWishlist: createBookDto.allowWishlist ?? true,
        enableNotifications: createBookDto.enableNotifications ?? false,
        visibility: createBookDto.visibility ?? 'public',
      };

      /**
       * 5️⃣ Save the book entry in the database
       */
      const createdBook = await this.createBookProvider.createBook(completeBookData);

      return createdBook;
    } catch (error: unknown) {
      let message = 'Unknown error during book creation';

      if (error instanceof Error) {
        message = error.message;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create book data',
          error: message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Creates multiple book records in a single transaction.
   *
   * Each book in the input list may optionally include uploaded files:
   * - `bookCover`: main cover image (JPEG, PNG)
   * - `snapshots`: list of image files (for previews)
   * - `file`: eBook or document (PDF, DOCX, etc.)
   *
   * This method:
   * 1. Uploads all files in parallel for each book.
   * 2. Creates database entries within a single transaction.
   * 3. Rolls back the entire operation if any upload or save fails.
   *
   * @param booksData - Array of book creation payloads containing DTOs and optional file objects.
   * @returns An array of successfully created {@link Book} entities.
   * @throws {HttpException} If any upload or database operation fails.
   *
   * @example
   * ```ts
   * await booksService.bulkCreate([
   *   { createBookDto: dto1, files: { bookCover: [...], file: [...] } },
   *   { createBookDto: dto2, files: { snapshots: [...] } }
   * ]);
   * ```
   */
  async bulkCreate(
    booksData: Array<{
      createBookDto: CreateBookDto;
      files?: {
        bookCover?: Express.Multer.File[];
        snapshots?: Express.Multer.File[];
        file?: Express.Multer.File[];
      };
    }>,
  ): Promise<Book[]> {
    const queryRunner: QueryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const createdBooks: Book[] = [];

      for (const data of booksData) {
        const { createBookDto, files } = data;

        let coverImageUrl: string | null = null;
        let snapshotUrls: string[] = [];
        let bookFileUrls: string[] = [];

        // Upload book file if provided
        if (files?.file?.length) {
          const uploadedFiles = await this.uploadBookFilesProvider.uploadPdfs(files.file);
          bookFileUrls = uploadedFiles;
        }

        // Upload cover image if provided
        if (files?.bookCover?.length) {
          const coverFile = files.bookCover[0];
          const [uploadedCoverUrl] = await this.uploadBookFilesProvider.uploadBuffers([
            {
              buffer: coverFile.buffer,
              filename: coverFile.originalname,
              mimetype: coverFile.mimetype,
            },
          ]);
          coverImageUrl = uploadedCoverUrl;
        }

        // Upload snapshots if provided
        if (files?.snapshots?.length) {
          const snapshotPayload = files.snapshots.map((file) => ({
            buffer: file.buffer,
            filename: file.originalname,
            mimetype: file.mimetype,
          }));
          snapshotUrls = await this.uploadBookFilesProvider.uploadBuffers(snapshotPayload);
        }

        // Merge file URLs with DTO
        const bookData: CreateBookDto = {
          ...createBookDto,
          coverImageUrl,
          snapshotUrls,
          bookFileUrls,
        };

        // Create the book record using the same transaction
        const book = queryRunner.manager.create(Book, bookData);
        const savedBook = await queryRunner.manager.save(book);
        createdBooks.push(savedBook);
      }

      // Commit all successfully created books
      await queryRunner.commitTransaction();

      this.logger.log(`✅ Bulk created ${createdBooks.length} books successfully`);
      return createdBooks;
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();

      let message = 'Failed to create books';
      if (error instanceof Error) {
        message = error.message;
      }

      this.logger.error(`❌ Bulk create failed: ${message}`);

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message,
          error: 'Bulk book creation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Retrieve all books from the database.
   *
   * @returns An array of all Book entities.
   */
  async getAllBooks(): Promise<Book[]> {
    // const allBook = await this.bookRepository.find({});
    // return allBook;

    return Promise.resolve([]);
  }

  /**
   * Retrieve a single book by its ID.
   *
   * @param id - The ID of the book to retrieve.
   * @returns The Book entity if found, otherwise null.
   */
  async getBookById(id: number): Promise<Book | null> {
    return await this.bookRepository.findOneBy({ id });
  }

  /**
   * Updates an existing book record.
   *
   * This method performs the following operations:
   * - Finds the target book by ID.
   * - Uploads new files (book file, cover image, and snapshots) if provided.
   * - Preserves existing URLs if no new files are uploaded.
   * - Merges existing data with updated values from the DTO.
   * - Saves the updated entity to the database.
   *
   * @param id - The unique identifier of the book to update.
   * @param updateBookDto - Data containing the fields to update.
   * @param files - Optional files for updating the book cover, snapshots, or content file.
   * @returns The updated {@link Book} entity.
   * @throws {NotFoundException} If the book with the specified ID does not exist.
   */
  async updateBook(
    id: number,
    updateBookDto: UpdateBookDto,
    files?: {
      bookCover?: Express.Multer.File[];
      snapshots?: Express.Multer.File[];
      file?: Express.Multer.File[];
    },
  ): Promise<Book> {
    const book = await this.bookRepository.findOneBy({ id });

    if (!book) {
      throw new NotFoundException(`Book with ID ${id} not found`);
    }

    let updatedCoverUrl = book.coverImageUrl;
    let updatedSnapshotUrls = book.snapshotUrls || [];
    let updatedBookFileUrls = book.bookFileUrls || [];

    /**
     * Upload new book files (PDF, Excel, etc.) if provided.
     * Replaces existing URLs with newly uploaded ones.
     */
    if (files?.file?.length) {
      const uploadedFiles = await this.uploadBookFilesProvider.uploadPdfs(files.file);
      updatedBookFileUrls = uploadedFiles;
    }

    /**
     * Upload a new cover image if provided.
     * Replaces the existing cover URL with the new one.
     */
    if (files?.bookCover?.length) {
      const coverFile = files.bookCover[0];
      const [newCoverUrl] = await this.uploadBookFilesProvider.uploadBuffers([
        {
          buffer: coverFile.buffer,
          filename: coverFile.originalname,
          mimetype: coverFile.mimetype,
        },
      ]);
      updatedCoverUrl = newCoverUrl;
    }

    /**
     * Upload new snapshot images if provided.
     * Replaces existing snapshot URLs with the new ones.
     */
    if (files?.snapshots?.length) {
      const snapshotPayload = files.snapshots.map((file) => ({
        buffer: file.buffer,
        filename: file.originalname,
        mimetype: file.mimetype,
      }));

      const newSnapshots = await this.uploadBookFilesProvider.uploadBuffers(snapshotPayload);
      updatedSnapshotUrls = newSnapshots;
    }

    /**
     * Merge the existing book entity with updated fields and file URLs.
     */
    const updatedBook = this.bookRepository.merge(book, {
      ...updateBookDto,
      coverImageUrl: updatedCoverUrl,
      snapshotUrls: updatedSnapshotUrls,
      bookFileUrls: updatedBookFileUrls,
      updatedAt: new Date(),
    });

    /**
     * Save and return the updated book entity.
     */
    return await this.bookRepository.save(updatedBook);
  }

  async findAll(queryParams?: FindAllBookQueryParam): Promise<FindAllBookResponse> {
    const paginatedBooks = await this.findBookProvider.findAll(queryParams);

    return {
      message: 'successfully able to find all books',
      ...paginatedBooks
    }
  }

  async findOne(id: number, options: FindOneBookOption) {
    const book = await this.findBookProvider.findOne(id, options);

    return {
      message: 'Desired book got successfully',
      book,
    }
  }

  async deleteBook(
    id: number,
    options: DeleteOption
  ) {
    const result = await this.deleteBookProvider.deleteBook(id, options);
    return result;
  }

  async putBook(_id: number, _data: any) { //eslint-disable-line
    return '';
  }
}
