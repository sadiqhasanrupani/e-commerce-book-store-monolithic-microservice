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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

  /**
   * Verify OTP by email and purpose
   * @param email - User's email address
   * @param otp - OTP code to verify
   * @param purpose - Purpose of OTP (REGISTRATION or LOGIN)
   * @returns boolean - true if OTP is valid, false otherwise
   */
  async verifyOtp(email: string, otp: string, purpose: string): Promise<boolean> {
    // Find user by email
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      return false;
    }

    // Find the most recent unused OTP for this user and purpose
    const verification = await this.emailVerificationRepository.findOne({
      where: { userId: user.id, purpose, used: false },
      order: { createdAt: 'DESC' },
    });

    if (!verification) {
      return false;
    }

    // Check if OTP has expired
    if (verification.expiresAt < new Date()) {
      return false;
    }

    // Verify OTP hash
    const isValid = await bcrypt.compare(otp, verification.tokenHash);
    if (!isValid) {
      verification.attempts += 1;
      await this.emailVerificationRepository.save(verification);
      return false;
    }

    // Mark OTP as used
    verification.used = true;
    await this.emailVerificationRepository.save(verification);
    return true;
  }
}
