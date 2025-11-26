import { CreateBookDto } from '../dtos/create-book.dto';

/**
 * Represents the complete payload required to create a single book.
 *
 * This includes:
 * - The validated DTO containing metadata and core book properties.
 * - Optional file uploads (cover image, snapshots, and book file).
 */
export interface CreateBookData {
  /** The data transfer object for creating a book. */
  createBookDto: CreateBookDto;

  /** Optional uploaded files associated with this book. */
  files?: {
    /**
     * The main cover image for the book.
     * Typically a single file (JPEG, PNG, WEBP, etc.).
     */
    bookCover?: Express.Multer.File;

    /**
     * Snapshot preview images (e.g., first few pages of the book).
     * Usually 5 for physical books or 10 for eBooks.
     */
    snapshots?: Express.Multer.File[];

    /**
     * ordered array of variant files (index -> variant order).
     */
    variantFiles?: Express.Multer.File[];
  };
}
