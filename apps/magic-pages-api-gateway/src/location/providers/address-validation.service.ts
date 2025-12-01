import { Injectable } from '@nestjs/common';

@Injectable()
export class AddressValidationService {
  private readonly POSTAL_CODE_REGEX: Record<string, RegExp> = {
    IN: /^[1-9][0-9]{5}$/, // India: 6 digits, no leading 0
    US: /^\d{5}(-\d{4})?$/, // USA: 5 digits, optional zip+4
    GB: /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/, // UK
    // Add more as needed
  };

  private readonly DEFAULT_REGEX = /^[a-zA-Z0-9\s-]{3,10}$/;

  validatePostalCode(postalCode: string, countryCode: string): boolean {
    const regex = this.POSTAL_CODE_REGEX[countryCode] || this.DEFAULT_REGEX;
    return regex.test(postalCode);
  }

  getValidationRegex(countryCode: string): string {
    const regex = this.POSTAL_CODE_REGEX[countryCode] || this.DEFAULT_REGEX;
    return regex.source;
  }
}
