import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [ClientsModule.register([
    {
      name: "AUTH_CLIENT",
      transport: Transport.TCP,
      options: { port: 3002 },
    }
  ])],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
