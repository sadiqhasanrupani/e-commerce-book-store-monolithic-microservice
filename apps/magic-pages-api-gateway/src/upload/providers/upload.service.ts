import { BadRequestException, Injectable } from '@nestjs/common';
import { UploadToStorageProvider } from './upload-to-storage.provider';
import { InjectRepository } from '@nestjs/typeorm';
import { Upload } from '@app/contract/uploads/entities/upload.entity';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { UploadFile } from '../interfaces/upload-file.interface';

import { Express } from 'express';

@Injectable()
export class UploadService {
  constructor(
    /**
     * Inject uploadToStorageProvider 
     * */
    private readonly uploadToStorageProvider: UploadToStorageProvider,

    /**
     * Inject uploadRepository
     * */
    @InjectRepository(Upload)
    private readonly uploadRepository: Repository<Upload>,

    /**
     * Inject configService
     * */
    private readonly configService: ConfigService,
  ) { }

  public async uploadFiles(files: Express.Multer.File[]): Promise<string[]> { 
    // check files having at-least one image
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one image or file must be uploaded')
    }   

    // Upload the files to MinIO space object storage
    const urls = await this.uploadToStorageProvider.uploadFiles(files);

    const uploadFiles: UploadFile[] = [];

    // Store each uploaded file in the database
    for (let i = 0; i < files.length; i++) {
      // Generate a new entry in database
      const uploadFile: UploadFile = {
        name: files[i].originalname,
        path: urls[i],
        type: files[i].mimetype.split('/')[0], // e.g., 'image' from 'image/jpeg'
        mime: files[i].mimetype,
        size: files[i].size.toString()
      };

      // uploadFiles.push(uploadFile)

      // Here you would typically save this to your database
      // For example:
      // await this.uploadRepository.save({
      //   name: uploadFile.name,
      //   type: uploadFile.type,
      //   path: uploadFile.path,
      //   mime: uploadFile.mime,
      //   size: uploadFile.size,
      // });
    }

    // Return the array of uploaded file URLs
    return urls;
  }
}
