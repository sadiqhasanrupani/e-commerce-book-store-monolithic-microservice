export enum BookFormat {
  // Physical formats
  HARDCOVER = 'hardcover',
  PAPERBACK = 'paperback',
  PHYSICAL = 'physical', // Generic physical

  // Digital formats
  EBOOK = 'ebook',
  PDF = 'pdf',
  EPUB = 'epub',
  AUDIOBOOK = 'audiobook',
  DOCX = 'docx',
  WORKSHEET = 'worksheet',
}

/**
 * Helper function to check if a format is physical
 */
export function isPhysicalFormat(format: BookFormat): boolean {
  return [BookFormat.HARDCOVER, BookFormat.PAPERBACK, BookFormat.PHYSICAL].includes(format);
}
