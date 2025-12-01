import { Injectable } from '@nestjs/common';
import * as geoip from 'geoip-lite';

export interface UserContext {
  currency: string;
  locale: string;
  countryCode: string;
}

@Injectable()
export class UserContextService {
  private readonly COUNTRY_CURRENCY_MAP: Record<string, string> = {
    US: 'USD',
    IN: 'INR',
    GB: 'GBP',
    DE: 'EUR',
    FR: 'EUR',
    IT: 'EUR',
    ES: 'EUR',
    NL: 'EUR',
    AU: 'AUD',
    CA: 'CAD',
    // Add more mappings as needed
  };

  private readonly DEFAULT_CONTEXT: UserContext = {
    currency: 'INR',
    locale: 'en-IN',
    countryCode: 'IN',
  };

  resolveContext(ip: string): UserContext {
    // Handle localhost/private IPs
    if (this.isPrivateIp(ip)) {
      return this.DEFAULT_CONTEXT;
    }

    const geo = geoip.lookup(ip);
    if (!geo || !geo.country) {
      return this.DEFAULT_CONTEXT;
    }

    const countryCode = geo.country;
    const currency = this.COUNTRY_CURRENCY_MAP[countryCode] || 'USD'; // Default to USD for unknown countries
    const locale = this.getLocaleForCountry(countryCode);

    return {
      currency,
      locale,
      countryCode,
    };
  }

  private isPrivateIp(ip: string): boolean {
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') || // Simplified private range check
      ip.startsWith('fc00:')
    );
  }

  private getLocaleForCountry(countryCode: string): string {
    const map: Record<string, string> = {
      US: 'en-US',
      IN: 'en-IN',
      GB: 'en-GB',
      DE: 'de-DE',
      FR: 'fr-FR',
      IT: 'it-IT',
      ES: 'es-ES',
      NL: 'nl-NL',
      AU: 'en-AU',
      CA: 'en-CA',
    };
    return map[countryCode] || 'en-US';
  }
}
