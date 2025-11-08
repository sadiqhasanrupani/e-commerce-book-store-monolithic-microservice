import { CreateBookDto } from '../dtos/create-book.dto';

export type CreateBookData = {
  createBookDto: CreateBookDto;
  files?: {
    bookCover: Express.Multer.File;
    snapshots?: Express.Multer.File[];
    file?: Express.Multer.File;
  };
};
