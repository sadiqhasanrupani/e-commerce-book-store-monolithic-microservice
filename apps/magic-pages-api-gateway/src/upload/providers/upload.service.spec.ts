import { Test, TestingModule } from '@nestjs/testing';
import { UploadService } from './upload.service';
import { UploadToStorageProvider } from './upload-to-minio.provider';
import { Express } from 'express';

describe('UploadService', () => {
  let service: UploadService;
  let minioProvider: UploadToStorageProvider;

  // Mock for UploadToMinioProvider
  const mockMinioProvider = {
    uploadFiles: jest
      .fn()
      .mockImplementation(async (files: Express.Multer.File[]) => {
        // Return fake URLs
        return files.map(
          (file, index) => `https://fakeurl.com/${index}-${file.originalname}`,
        );
      }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        {
          provide: UploadToStorageProvider,
          useValue: mockMinioProvider,
        },
      ],
    }).compile();

    service = module.get<UploadService>(UploadService);
    minioProvider = module.get<UploadToStorageProvider>(UploadToStorageProvider);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call UploadToMinioProvider.uploadFiles and return URLs', async () => {
    const fakeFiles: Express.Multer.File[] = [
      {
        originalname: 'test1.jpg',
        buffer: Buffer.from('fake content'),
        mimetype: 'image/jpeg',
      } as Express.Multer.File,
      {
        originalname: 'test2.png',
        buffer: Buffer.from('fake content'),
        mimetype: 'image/png',
      } as Express.Multer.File,
    ];

    const result = await service.uploadFiles(fakeFiles);

    // Should return mocked URLs
    expect(result).toEqual([
      'https://fakeurl.com/0-test1.jpg',
      'https://fakeurl.com/1-test2.png',
    ]);

    // Should call the provider once with the files
    expect(minioProvider.uploadFiles).toHaveBeenCalledTimes(1);
    expect(minioProvider.uploadFiles).toHaveBeenCalledWith(fakeFiles);
  });

  it('should propagate errors from UploadToMinioProvider', async () => {
    const errorMessage = 'Upload failed';

    // Simulate provider throwing an error
    mockMinioProvider.uploadFiles.mockRejectedValueOnce(
      new Error(errorMessage),
    );

    const fakeFiles: Express.Multer.File[] = [
      {
        originalname: 'fail.jpg',
        buffer: Buffer.from('fake content'),
        mimetype: 'image/jpeg',
      } as Express.Multer.File,
    ];

    // ✅ This is the correct way to test async rejection
    await expect(service.uploadFiles(fakeFiles)).rejects.toThrow(errorMessage);
  });
});
