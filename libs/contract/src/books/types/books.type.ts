import { CreateBookDto } from "../dtos/create-book.dto";

export type CreateBookData = {
  createBookDto: CreateBookDto;
  files?: {
    images?: Express.Multer.File[];
    files?: Express.Multer.File[];
  };
}
