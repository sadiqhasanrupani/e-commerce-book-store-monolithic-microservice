import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Auth, ApprovalStatus } from './entities/auth.entity';
import { RegisterAuthDto } from '@app/contract/auth/dtos/register-auth.dto';
import { LoginAuthDto } from '@app/contract/auth/dtos/login-auth.dto';
import { EmailService } from './provider/email.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Auth)
    private readonly authRepository: Repository<Auth>,
    private readonly emailService: EmailService,
  ) {}

  async register(registerAuthDto: RegisterAuthDto) {
    const { email, password } = registerAuthDto;
    // Check if user already exists
    const existing = await this.authRepository.findOne({ where: { email } });
    if (existing) {
      throw new BadRequestException('Email already registered');
    }
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // Create user with approval pending
    const user = this.authRepository.create({
      email,
      password: hashedPassword,
      otp,
      approvalStatus: ApprovalStatus.PENDING,
    });
  await this.authRepository.save(user);
  // Send OTP to user via email
  await this.emailService.sendOtpEmail(email, otp);
  return { message: 'Registration successful. Please verify OTP.', userId: user.id };
  }

  async verifyOtp(email: string, otp: string) {
    const user = await this.authRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    if (user.otp !== otp) throw new BadRequestException('Invalid OTP');
  user.approvalStatus = ApprovalStatus.APPROVED;
  user.otp = '';
  await this.authRepository.save(user);
  return { message: 'OTP verified. Registration complete.' };
  }

  async login(loginUserDto: LoginAuthDto) {
    // ...existing code...
    return `This action logs in a user`;
  }

  validate() {
    // ...existing code...
    return `This action validate a user`;
  }
}
