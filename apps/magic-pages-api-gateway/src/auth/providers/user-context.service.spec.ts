import { Test, TestingModule } from '@nestjs/testing';
import { UserContextService } from './user-context.service';
import * as geoip from 'geoip-lite';

jest.mock('geoip-lite', () => ({
  lookup: jest.fn(),
}));

describe('UserContextService', () => {
  let service: UserContextService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserContextService],
    }).compile();

    service = module.get<UserContextService>(UserContextService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveContext', () => {
    it('should return default context for private IP', () => {
      const context = service.resolveContext('127.0.0.1');
      expect(context).toEqual({
        currency: 'INR',
        locale: 'en-IN',
        countryCode: 'IN',
      });
    });

    it('should return default context if geoip lookup fails', () => {
      (geoip.lookup as jest.Mock).mockReturnValue(null);
      const context = service.resolveContext('8.8.8.8');
      expect(context).toEqual({
        currency: 'INR',
        locale: 'en-IN',
        countryCode: 'IN',
      });
    });

    it('should return correct context for US IP', () => {
      (geoip.lookup as jest.Mock).mockReturnValue({ country: 'US' });
      const context = service.resolveContext('1.1.1.1');
      expect(context).toEqual({
        currency: 'USD',
        locale: 'en-US',
        countryCode: 'US',
      });
    });

    it('should return correct context for IN IP', () => {
      (geoip.lookup as jest.Mock).mockReturnValue({ country: 'IN' });
      const context = service.resolveContext('1.1.1.1');
      expect(context).toEqual({
        currency: 'INR',
        locale: 'en-IN',
        countryCode: 'IN',
      });
    });

    it('should return default currency (USD) for unknown country', () => {
      (geoip.lookup as jest.Mock).mockReturnValue({ country: 'XX' });
      const context = service.resolveContext('1.1.1.1');
      expect(context).toEqual({
        currency: 'USD',
        locale: 'en-US',
        countryCode: 'XX',
      });
    });
  });
});
