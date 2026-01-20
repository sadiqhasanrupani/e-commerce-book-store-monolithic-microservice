import { ArgumentMetadata, Injectable, PipeTransform, ValidationPipe } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

@Injectable()
export class HybridValidationPipe implements PipeTransform {
  private readonly classValidatorPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });

  private readonly zodPipe = new ZodValidationPipe();

  async transform(value: any, metadata: ArgumentMetadata) {
    const metatype = metadata.metatype;

    // Check if it's a Zod DTO. nestjs-zod DTOs usually have 'zodSchema' or 'isZodDto'.
    // We check for 'zodSchema' as it's the core property.
    if (metatype && ((metatype as any).zodSchema || (metatype as any).isZodDto)) {
      return this.zodPipe.transform(value, metadata);
    }

    return this.classValidatorPipe.transform(value, metadata);
  }
}
