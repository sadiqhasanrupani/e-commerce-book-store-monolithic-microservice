import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class ParseEntityIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = Number(value);

    if (isNaN(id) || id <= 0 || !Number.isInteger(id)) {
      throw new BadRequestException('Invalid ID format — must be a positive integer');
    }

    return id;
  }
}
