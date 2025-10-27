import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

/**
 * Service to interact with MinIO (or any S3-compatible storage).
 * Provides methods for uploading and retrieving files.
 */
@Injectable()
export class MinioService {
  /** AWS S3 client instance used for interacting with MinIO */
  private readonly s3Client: S3Client;

  /** Default bucket name to store files */
  private readonly bucket: string;

  /**
   * Initializes the MinIO service.
   * Sets up the S3 client with credentials and endpoint from environment variables.
   *
   * @param configService - NestJS ConfigService for accessing environment variables
   */
  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('s3.storageBucket') || '';

    this.s3Client = new S3Client({
      // region: 'us-east-1', // Region is required but not used by MinIO
      endpoint: `http://${this.configService.get('s3.storageEndpoint')}:${this.configService.get<number>('s3.storagePort')}`,
      credentials: {
        accessKeyId: this.configService.get<string>('s3.storageAccessKey') || '',
        secretAccessKey: this.configService.get<string>('s3.storageSecretKey') || '',
      },
      forcePathStyle: true, // Required for MinIO path-style requests
    });
  }

  /**
   * Uploads a file to the configured MinIO bucket.
   *
   * @param key - The file key (path + filename) in the bucket
   * @param buffer - The file contents as a Buffer
   * @param contentType - MIME type of the file (e.g., 'image/png')
   * @returns The public URL of the uploaded file
   */
  async uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return `http://${this.configService.get('MINIO_ENDPOINT')}:${this.configService.get('MINIO_PORT')}/${this.bucket}/${key}`;
  }

  /**
   * Retrieves a file from the MinIO bucket.
   *
   * @param key - The file key (path + filename) in the bucket
   * @returns A Readable stream of the file contents
   */
  async getFile(key: string): Promise<Readable> {
    const result = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return result.Body as Readable;
  }
}
