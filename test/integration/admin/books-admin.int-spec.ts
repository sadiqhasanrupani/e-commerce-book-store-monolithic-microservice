
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { MagicPagesApiGatewayModule } from '../../../apps/magic-pages-api-gateway/src/magic-pages-api-gateway.module';
import { JwtService } from '@nestjs/jwt';
import { RoleTypes } from '@app/contract/auth/enums/role-types.enum';
import { CreateBookDto } from '@app/contract/books/dtos/create-book.dto';
import { BookGenre } from '@app/contract/books/enums/book-genres.enum';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';

describe('Admin Books Controller (Integration)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MagicPagesApiGatewayModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);

    // Generate tokens
    const adminPayload = { sub: 'admin-uuid', email: 'admin@test.com', role: RoleTypes.ADMIN };
    adminToken = await jwtService.signAsync(adminPayload);

    const userPayload = { sub: 'user-uuid', email: 'user@test.com', role: RoleTypes.USER };
    userToken = await jwtService.signAsync(userPayload);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /admin/books', () => {
    it('should forbid public access', async () => {
      await request(app.getHttpServer())
        .get('/admin/books')
        .expect(401);
    });

    it('should forbid non-admin user', async () => {
      await request(app.getHttpServer())
        .get('/admin/books')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('should allow admin user', async () => {
      await request(app.getHttpServer())
        .get('/admin/books')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('CRUD Operations', () => {
    let createdBookId: string;

    it('should create a book with snapshots', async () => {
      const dto: CreateBookDto = {
        title: 'Integration Test Book ' + Date.now(),
        description: 'Test Description',
        genre: BookGenre.FANTASY,
        authorName: 'Test Author',
        priceCents: 1000, // Legacy support if needed, or via variants
        variants: [
          {
            format: BookFormat.HARDCOVER,
            priceCents: 2000,
            stockQuantity: 10,
            isbn: '978-3-16-148410-0'
          }
        ],
        snapshots: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
      };

      const res = await request(app.getHttpServer())
        .post('/admin/books')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.snapshots).toHaveLength(2);
      expect(res.body.snapshots).toEqual(expect.arrayContaining(dto.snapshots));
      createdBookId = res.body.id;
    });

    it('should update snapshots', async () => {
      const newSnapshots = ['https://example.com/image3.jpg'];
      const res = await request(app.getHttpServer())
        .put(`/admin/books/${createdBookId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ snapshots: newSnapshots })
        .expect(200);

      // Depending on implementation (merge vs replace). 
      // The implementation does replace: "if (newSnapshotUrls) bookPatch.snapshotUrls = newSnapshotUrls;" checks for UPLOADED files.
      // But we are sending DTO.
      // In BooksService.updateBook:
      // "const updatableFields ... includes 'snapshots'"
      // "if ((dto as any)[f] !== undefined) ... (bookPatch)[f] = (dto)[f]"
      // So it should REPLACE the field with DTO value.

      expect(res.body.updatedBook.snapshots).toEqual(newSnapshots);
    });

    it('should toggle status via PATCH', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/admin/books/${createdBookId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isFeatured: true })
        .expect(200);

      expect(res.body.isFeatured).toBe(true);
    });

    it('should soft delete the book', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/books/${createdBookId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Verify it's gone from public find
      // Or verification via admin find check deletedAt?
      // deleteBook returns the deleted entity or result.
    });
  });
});
