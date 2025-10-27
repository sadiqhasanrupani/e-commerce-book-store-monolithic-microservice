import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

interface FileFields {
  [field: string]: string[];
}

@Injectable()
export class FilesValidationPipe implements PipeTransform {
  constructor(private readonly allowedMimes: FileFields) { }

  transform(files: Record<string, Express.Multer.File[]>) {
    if (!files || Object.keys(files).length === 0) {
      throw new BadRequestException('Files are required');
    }

    for (const field in files) {
      const allowed = this.allowedMimes[field] || [];
      for (const file of files[field]) {
        if (!allowed.includes(file.mimetype)) {
          throw new BadRequestException(
            `Invalid file type for field "${field}": ${file.originalname}`,
          );
        }
      }
    }

    return files;
  }
}
