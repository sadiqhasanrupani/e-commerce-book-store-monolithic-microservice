import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrowseFormat } from '@app/contract/browse/entities/browse-format.entity';
import { BooksService } from '../../books/providers/books.service';
import { FindAllBookQueryParam } from '@app/contract/books/types/find-book.type';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';

@Injectable()
export class FormatsService {
  constructor(
    @InjectRepository(BrowseFormat)
    private readonly formatRepository: Repository<BrowseFormat>,
    private readonly booksService: BooksService,
  ) { }

  async findAll() {
    const formats = await this.formatRepository.find({
      order: { sortOrder: 'ASC' },
    });
    return { data: formats };
  }

  async findBooksByFormat(formatId: string, query: FindAllBookQueryParam) {
    let formatEnum: BookFormat | undefined;

    // Check if formatId is a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(formatId);

    if (isUuid) {
      const format = await this.formatRepository.findOneBy({ id: formatId });
      if (!format) {
        throw new NotFoundException(`Format with ID '${formatId}' not found`);
      }
      // Best effort mapping: label to lowercase. 
      // Ideally BrowseFormat should have a 'code' or 'value' field.
      // For now, we assume label matches enum values when lowercased.
      const mappedFormat = format.label.toLowerCase();
      if (Object.values(BookFormat).includes(mappedFormat as BookFormat)) {
        formatEnum = mappedFormat as BookFormat;
      } else {
        // Fallback or error? Let's try to use it as is or throw.
        // If the label is "Physical", it maps to "physical" which is in BookFormat.
        // If label is "Hardcover", maps to "hardcover".
        console.warn(`Could not map BrowseFormat label '${format.label}' to BookFormat enum directly.`);
        // We might want to just pass it anyway if we trust it.
        formatEnum = mappedFormat as any;
      }
    } else {
      // Assume it's a direct format code (e.g. "hardcover")
      if (Object.values(BookFormat).includes(formatId as BookFormat)) {
        formatEnum = formatId as BookFormat;
      } else {
        // If it's not a valid enum, we could throw or just pass it and let BooksService return empty.
        // But BooksService might error if we pass invalid enum? 
        // BooksService uses it in query: fmt.format IN (:...formats)
        // It should be fine to pass string.
        formatEnum = formatId as any;
      }
    }

    const booksQuery: FindAllBookQueryParam = {
      ...query,
      formats: formatEnum ? [formatEnum] : [],
    };

    return this.booksService.findAll(booksQuery);
  }
}
