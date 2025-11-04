import { IsEmail, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Gender } from '../enums/gender.enum';

export class CreateUserDto {
  @IsOptional()
  @IsNumber()
  id?: number;

  @IsNotEmpty()
  @IsString()
  firstName: string;
  
  @IsNotEmpty()
  @IsString()
  lastName: string;
  
  @IsNotEmpty()
  @IsString()
  @IsEmail()
  email: string;

  @IsEnum(Gender, { message: `Gender must be "male","female" or "other"` })
  gender: Gender;
}
