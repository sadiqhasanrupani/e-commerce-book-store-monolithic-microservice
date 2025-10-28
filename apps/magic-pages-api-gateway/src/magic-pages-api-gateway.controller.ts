import { Controller, Get } from '@nestjs/common';
import { MagicPagesApiGatewayService } from './magic-pages-api-gateway.service';

@Controller()
export class MagicPagesApiGatewayController {
  constructor(private readonly magicPagesApiGatewayService: MagicPagesApiGatewayService) {}

  @Get()
  getHello(): string {
    return this.magicPagesApiGatewayService.getHello();
  }
}
