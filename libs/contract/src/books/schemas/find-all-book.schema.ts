import { z } from 'zod';
import { BookFormat } from '../enums/book-format.enum';
import { BookGenre } from '../enums/book-genres.enum';
import { BookAvailability } from '../enums/book-avaliability.enum';

// Helper: Transforms 'true'/'false' strings to actual booleans
const booleanString = z
  .preprocess((val) => String(val), z.enum(['true', 'false']))
  .transform((value) => value === 'true')
  .optional();

// Helper: Transforms single string to array (e.g. ?cat=A -> ['A'])
const arrayString = z
  .union([z.string(), z.array(z.string())])
  .transform((val) => (Array.isArray(val) ? val : [val]))
  .optional();

export const FindAllBookQuerySchema = z.object({
  // --- Numbers (Auto-convert string "5" to number 5) ---
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),

  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  maxRating: z.coerce.number().min(0).max(5).optional(),

  // --- Strings & Enums ---
  q: z.string().trim().optional(),
  sortBy: z.string().optional(), // Replace with specific keys if known: z.enum(['price', 'title'])
  sortOrder: z.enum(['ASC', 'DESC']).optional(),
  genre: z.nativeEnum(BookGenre).optional(), // Replace with your BookGenre enum
  authorName: z.string().trim().optional(),
  availability: z.nativeEnum(BookAvailability).optional(), // Replace with BookAvailability

  // --- Arrays (Handles ?formats=A&formats=B and ?formats=A) ---
  formats: arrayString.pipe(z.array(z.nativeEnum(BookFormat))).optional(),
  ageGroups: arrayString.optional(),
  categories: arrayString.optional(),

  // --- Booleans (Handles "true"/"false" strings) ---
  includeArchived: booleanString,
  isFeatured: booleanString,
  isBestseller: booleanString,
  isBestSeller: booleanString.optional(),
  isNewRelease: booleanString,

  visibility: z.enum(['public', 'private', 'draft', 'all']).optional(),
});

// Extract the type automatically from the schema
export type FindAllBookDtoType = z.infer<typeof FindAllBookQuerySchema>;
