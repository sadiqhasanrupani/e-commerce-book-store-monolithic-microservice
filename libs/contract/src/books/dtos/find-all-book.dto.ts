import { createZodDto } from 'nestjs-zod';
import { FindAllBookQuerySchema } from '../schemas/find-all-book.schema'; // Import the schema we created

// This class automagically inherits all the types and validation logic
export class FindAllBookDto extends createZodDto(FindAllBookQuerySchema) { }
