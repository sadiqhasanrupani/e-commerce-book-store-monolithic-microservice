import { IsString, IsOptional, IsDateString, MaxLength } from 'class-validator';

export class CreateAuthorDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  nationality?: string;
}
