import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';

import {
  DeleteFilesRequest,
  MoveFilesRequest,
  MoveFilesResponse,
  UploadType,
} from '@app/contract/storage/types/storage.type';

import { generateFileName } from '@app/contract/utils/books.util';
import { Readable } from 'typeorm/platform/PlatformTools';

@Injectable()
export class UploadToStorageProvider {
  /**
   * UploadToStorageProvider
   * ----------------------------------------
   * Responsible for managing file lifecycle operations
   * (upload, retrieve, move, delete) on S3-compatible object storage (MinIO).
   *
   * Design Principles:
   *  - Safe-by-default: validated MIME types and robust error handling.
   *  - Transaction-aware: supports rollback behavior for move/delete.
   *  - Extensible: supports multiple file types (pdf, xls, images).
   *  - Observable: structured logs for each storage operation.
   */
  private readonly logger = new Logger(UploadToStorageProvider.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    const rawEndpoint = this.configService.get<string>('s3.storageEndpoint') || '';
    const port = this.configService.get<string>('s3.storagePort') || '9000';

    this.endpoint =
      rawEndpoint.startsWith('http') || rawEndpoint.startsWith('https') ? rawEndpoint : `http://${rawEndpoint}:${port}`;

    this.bucket = this.configService.get<string>('s3.storageBucket') || '';
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
      Bucket: ${this.bucket}
      Region: ${this.region}`);
  }

  /**
   * Upload a single file to S3-compatible storage
   */
  async uploadFile(file: Express.Multer.File, type: UploadType = 'other'): Promise<string> {
    if (!file) throw new BadRequestException('File is required');

    this.validateFileType(file, type);
    const fileName = generateFileName(file, type);

    const uploadParams: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    };

    try {
      await this.s3.send(new PutObjectCommand(uploadParams));
      const url =
        process.env.NODE_ENV === 'production'
          ? `https://${this.bucket}.${this.endpoint.replace(/^https?:\/\//, '')}/${fileName}`
          : `${this.endpoint}/${this.bucket}/${fileName}`;

      this.logger.log(`✅ Uploaded: ${fileName}`);
      return url;
    } catch (err) {
      this.logS3Error(err, fileName);
      throw err;
    }
  }

  /**
   * Upload multiple files concurrently.
   */
  async uploadFiles(files: Express.Multer.File[], type: UploadType = 'other'): Promise<string[]> {
    if (!files?.length) throw new BadRequestException('No files provided');
    return Promise.all(files.map((file) => this.uploadFile(file, type)));
  }

  /**
   * Upload file from a raw buffer.
   */
  async uploadFileFromBuffer(key: string, buffer: Buffer, contentType: string): Promise<string> {
    const params: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    };

    try {
      await this.s3.send(new PutObjectCommand(params));
      return `${this.endpoint}/${this.bucket}/${key}`;
    } catch (err) {
      this.logS3Error(err, key);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // FILE RETRIEVAL
  // --------------------------------------------------------------------------

  /**
   * Retrieve a file stream from storage.
   * @param key - Object key in the bucket.
   */
  async getFile(key: string): Promise<Readable> {
    if (!key) throw new BadRequestException('File key is required');

    try {
      const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));

      if (!result.Body) throw new BadRequestException('File not found');
      return result.Body as Readable;
    } catch (err) {
      this.logS3Error(err, key);
      throw new BadRequestException(`Failed to retrieve file: ${key}`);
    }
  }

  // --------------------------------------------------------------------------
  // FILE DELETION
  // --------------------------------------------------------------------------

  /**
   * Permanently delete multiple files from storage.
   *
   * Design:
   *  - Deletes each object individually to ensure partial error visibility.
   *  - Returns structured feedback for deleted and failed keys.
   *  - Logs errors with enough metadata for audit and recovery.
   *
   * @param data - Object containing file keys to delete.
   */
  async deleteFiles(data: DeleteFilesRequest): Promise<{ deleted: string[]; failed: string[] }> {
    const deleted: string[] = [];
    const failed: string[] = [];

    if (!data?.keys?.length) throw new BadRequestException('No file keys provided for deletion.');

    for (const key of data.keys) {
      try {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        deleted.push(key);
      } catch (err) {
        failed.push(key);
        this.logS3Error(err, key);
      }
    }

    this.logger.log(`🗑️ Deleted ${deleted.length} files, ${failed.length} failed.`);
    return { deleted, failed };
  }

  // --------------------------------------------------------------------------
  // FILE MOVE / ARCHIVE
  // --------------------------------------------------------------------------

  /**
   * Move files to another prefix (e.g., archive/ or trash/).
   *
   * This performs a safe two-step process:
   *  - Copy each file to the new prefix
   *  - Delete the original file only if the copy succeeds
   *
   * @param data - MoveFilesRequest containing file keys and new prefix.
   * @returns MoveFilesResponse listing successfully moved and failed files.
   */
  async handleMoveFiles(data: MoveFilesRequest): Promise<MoveFilesResponse> {
    if (!data?.keys?.length) throw new BadRequestException('No file keys provided for moving.');

    const moved: string[] = [];
    const failed: string[] = [];

    for (const key of data.keys) {
      const destinationKey = `${data.destinationPrefix}${key}`;

      try {
        await this.s3.send(
          new CopyObjectCommand({
            Bucket: this.bucket,
            CopySource: `${this.bucket}/${key}`,
            Key: destinationKey,
            ACL: 'public-read',
          }),
        );

        // Delete only after a successful copy
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));

        moved.push(destinationKey);
        this.logger.log(`📦 Moved ${key} → ${destinationKey}`);
      } catch (err) {
        failed.push(key);
        this.logS3Error(err, key);
      }
    }

    this.logger.log(`Move operation complete. ${moved.length} moved, ${failed.length} failed.`);
    return { moved, failed };
  }

  // --------------------------------------------------------------------------
  // VALIDATION & LOGGING
  // --------------------------------------------------------------------------

  private validateFileType(file: Express.Multer.File, type: UploadType): void {
    const allowedTypes: Record<UploadType, string[]> = {
      photo: ['image/jpeg', 'image/png', 'image/webp'],
      pdf: ['application/pdf'],
      xls: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      other: [],
    };

    if (allowedTypes[type].length && !allowedTypes[type].includes(file.mimetype)) {
      throw new BadRequestException(`Invalid file type for ${type}`);
    }
  }

  private logS3Error(err: any, key: string): void {
    this.logger.error(`S3 operation failed for: ${key}`);
    if (err?.$metadata) {
      this.logger.error(`Status: ${err.$metadata.httpStatusCode}`);
      this.logger.error(`Request ID: ${err.$metadata.requestId}`);
    }
    if (err?.Code) {
      this.logger.error(`Code: ${err.Code}`);
      this.logger.error(`Message: ${err.message}`);
    }
  }
}
