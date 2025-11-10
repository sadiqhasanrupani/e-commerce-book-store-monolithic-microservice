import { BadRequestException, Injectable, Logger, PipeTransform } from '@nestjs/common';

interface FileFields {
  [field: string]: string[];
}

interface FileValidationOptions {
  allowedMimes: FileFields;
  requiredFields?: string[];
}

interface FileValidationErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

@Injectable()
export class FilesValidationPipe implements PipeTransform {
  private readonly logger = new Logger(FilesValidationPipe.name);

  constructor(private readonly options: FileValidationOptions) { }

  transform(files: Record<string, Express.Multer.File[]> | undefined) {
    const { allowedMimes, requiredFields = [] } = this.options;

    this.logger.log("allowedMimes", allowedMimes); 
    this.logger.log("files", files); 

    // No files uploaded at all
    if (!files || Object.keys(files).length === 0) {
      const expectedFiles = Object.keys(allowedMimes).map((f) => ({
        field: f,
        allowed: allowedMimes[f],
        required: requiredFields.includes(f),
      }));

      throw new BadRequestException(<FileValidationErrorResponse>{
        message: 'No files uploaded. Please attach the required files.',
        errors: Object.fromEntries(
          expectedFiles.map(({ field, allowed, required }) => [
            field,
            [
              `${required ? 'Required' : 'Optional'} field. Allowed types: ${allowed.join(', ')}`,
            ],
          ]),
        ),
      });
    }

    const missingFields: Record<string, string[]> = {};
    const invalidMimes: Record<string, string[]> = {};

    // Check missing required fields
    for (const field of requiredFields) {
      if (!files[field] || files[field].length === 0) {
        missingFields[field] = ['This file is required'];
      }
    }

    // Check invalid MIME types
    for (const field in files) {
      const allowed = allowedMimes[field] || [];
      const invalidFiles = files[field].filter(
        (file) => !allowed.includes(file.mimetype),
      );

      if (invalidFiles.length > 0) {
        invalidMimes[field] = invalidFiles.map(
          (file) =>
            `Invalid type for "${file.originalname}" (${file.mimetype}). Allowed: ${allowed.join(', ')}`,
        );
      }
    }

    // Build structured error object for frontend
    if (Object.keys(missingFields).length > 0 || Object.keys(invalidMimes).length > 0) {
      const errors: Record<string, string[]> = {
        ...missingFields,
        ...invalidMimes,
      };

      throw new BadRequestException(<FileValidationErrorResponse>{
        message: 'File validation failed',
        errors,
      });
    }

    return files;
  }
}
