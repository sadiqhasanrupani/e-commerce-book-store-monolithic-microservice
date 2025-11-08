import { Injectable } from '@nestjs/common';

@Injectable()
// abstract class
export abstract class HashingProvider {
  abstract hashPassword(data: string | Buffer): Promise<string>;

  abstract comparePassword(data: string | Buffer, encrypted: string): Promise<boolean>;
}
