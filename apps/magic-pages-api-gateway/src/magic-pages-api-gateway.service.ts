import { Injectable } from '@nestjs/common';

@Injectable()
export class MagicPagesApiGatewayService {
  getHello(): string {
    return 'Hello World!';
  }
}
