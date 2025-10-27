import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, PutObjectCommandInput, GetObjectCommandInput, GetObjectCommand } from '@aws-sdk/client-s3';

import { UploadType } from "@app/contract/storage/types/storage.type";

import { generateFileName } from '@app/contract/utils/books.util';
import { Readable } from 'typeorm/platform/PlatformTools';

@Injectable()
export class UploadToStorageProvider {
  private readonly logger = new Logger(UploadToStorageProvider.name);
  private readonly s3: S3Client;
  private readonly bucketName: string;
  private readonly endpoint: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    const rawEndpoint = this.configService.get<string>('s3.storageEndpoint') || '';
    const port = this.configService.get<string>('s3.storagePort') || '9000';

    this.endpoint = rawEndpoint.startsWith('http') || rawEndpoint.startsWith('https') ? rawEndpoint : `http://${rawEndpoint}:${port}`;

    this.bucketName = this.configService.get<string>('s3.storageBucket') || '';
    this.region = this.configService.get<string>('s3.storageRegion') || 'us-east-1';

    const accessKeyId = this.configService.get<string>('s3.storageAccessKey') || '';
    const secretAccessKey = this.configService.get<string>('s3.storageSecretKey') || '';

    this.s3 = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    this.logger.log(`S3 Client configured:

      Endpoint: ${this.endpoint}
      Bucket: ${this.bucketName}
      Region: ${this.region}
    `);
  }

  /**
   * Upload a single file to S3-compatible storage
   */
  async uploadFile(file: Express.Multer.File, type: UploadType = 'other'): Promise<string> {
    if (!file) throw new BadRequestException('File is required');

    this.validateFileType(file, type);

    const fileName = generateFileName(file, type);
    const uploadParams: PutObjectCommandInput = {
      Bucket: this.bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    };

    try {
      this.logger.log(`Uploading file: ${file.originalname} as ${fileName}`);

      const result = await this.s3.send(new PutObjectCommand(uploadParams));
      this.logger.debug(`S3 upload result: ${JSON.stringify(result)}`);

      const url =
        this.configService.get<string>('NODE_ENV') === 'production'
          ? `https://${this.bucketName}.${this.endpoint.replace(/^https?:\/\//, '')}/${fileName}`
          : `${this.endpoint}/${this.bucketName}/${fileName}`;

      this.logger.log(`✅ Successfully uploaded: ${url}`);
      return url;
    } catch (err) {
      this.logS3Error(err, file.originalname);
      throw err;
    }
  }

  async uploadFileFromBuffer(key: string, buffer: Buffer, contentType: string): Promise<string> {
    if (!buffer) throw new BadRequestException('File is required');

    const uploadParams: PutObjectCommandInput = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    };

    try {
      const result = await this.s3.send(new PutObjectCommand(uploadParams));

      const url =
        this.configService.get<string>('NODE_ENV') === 'production'
          ? `https://${this.bucketName}.${this.endpoint.replace(/^https?:\/\//, '')}/${key}`
          : `${this.endpoint}/${this.bucketName}/${key}`;

      return url;
    } catch (err) {
      this.logS3Error(err, key);
      throw err;
    }
  }

  /**
   * Upload multiple files to S3-compatible storage
   */
  async uploadFiles(files: Express.Multer.File[], type: UploadType = 'other'): Promise<string[]> {
    if (!files?.length) throw new BadRequestException('No files provided');

    const uploadedUrls: string[] = [];
    for (const file of files) {
      const url = await this.uploadFile(file, type);
      uploadedUrls.push(url);
    }

    return uploadedUrls;
  }


  /**
   * Validate file type based on allowed MIME types
   */
  private validateFileType(file: Express.Multer.File, type: UploadType): void {
    const mime = file.mimetype;

    const allowedTypes: Record<UploadType, string[]> = {
      photo: ['image/jpeg', 'image/png', 'image/webp'],
      pdf: ['application/pdf'],
      xls: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      other: [],
    };

    if (allowedTypes[type].length && !allowedTypes[type].includes(mime)) {
      throw new BadRequestException(`Invalid file type for ${type}: ${mime}`);
    }
  }

  /**
   * Log detailed S3 upload errors
   */
  private logS3Error(err: any, fileName: string) {
    this.logger.error(`❌ Upload failed for: ${fileName}`);
    if (err.$metadata) {
      this.logger.error(`Status: ${err.$metadata.httpStatusCode}`);
      this.logger.error(`Request ID: ${err.$metadata.requestId}`);
    }
    if (err.Code) {
      this.logger.error(`Code: ${err.Code}`);
      this.logger.error(`Message: ${err.message}`);
    }
  }

  /**
     * Get a file from S3/MinIO storage
     * @param key The file key in the bucket
     * @returns A readable stream of the file
     */
  async getFile(key: string): Promise<Readable> {
    if (!key) {
      throw new BadRequestException('File key is required');
    }

    const params: GetObjectCommandInput = {
      Bucket: this.bucketName,
      Key: key,
    };

    try {
      const result = await this.s3.send(new GetObjectCommand(params));
      // The Body is a Readable stream
      if (!result.Body) {
        throw new BadRequestException('File not found');
      }
      return result.Body as Readable;
    } catch (err: any) {
      this.logger.error(`❌ Failed to get file: ${key}`);
      if (err.Code) this.logger.error(`Code: ${err.Code}, Message: ${err.message}`);
      throw new BadRequestException(`Failed to get file: ${key}`);
    }
  }

}
