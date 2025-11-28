import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailVerification } from '@app/contract/auth/entities/email-verification.entity';
import { User } from '@app/contract/users/entities/user.entity';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require('bcrypt');

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(EmailVerification)
    private readonly emailVerificationRepository: Repository<EmailVerification>,
  ) { }

  async generateAndSaveOtp(user: User, purpose: string): Promise<string> {
    const otp = crypto.randomInt(100000, 999999).toString();
    const hash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    const verification = this.emailVerificationRepository.create({
      user,
      purpose,
      tokenHash: hash,
      tokenType: 'OTP',
      expiresAt,
    });

    await this.emailVerificationRepository.save(verification);
    return otp;
  }

  async verifyOtp(userId: number, otp: string, purpose: string): Promise<boolean> {
    const verification = await this.emailVerificationRepository.findOne({
      where: { userId, purpose, used: false },
      order: { createdAt: 'DESC' },
    });

    if (!verification) {
      return false;
    }

    if (verification.expiresAt < new Date()) {
      return false;
    }

    const isValid = await bcrypt.compare(otp, verification.tokenHash);
    if (!isValid) {
      verification.attempts += 1;
      await this.emailVerificationRepository.save(verification);
      return false;
    }

    verification.used = true;
    await this.emailVerificationRepository.save(verification);
    return true;
  }
}
