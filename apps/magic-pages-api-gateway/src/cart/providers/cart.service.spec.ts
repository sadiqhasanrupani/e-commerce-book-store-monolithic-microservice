import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Cart } from '@app/contract/carts/entities/cart.entity';
import { CartItem } from '@app/contract/carts/entities/cart-item.entity';
import { BookFormatVariant } from '@app/contract/books/entities/book-format-varient.entity';
import { Book } from '@app/contract/books/entities/book.entity';
import { RedisService } from '@app/redis';
import { DataSource, Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CartStatus } from '@app/contract/carts/enums/cart-status.enum';
import { BookFormat } from '@app/contract/books/enums/book-format.enum';

describe('CartService', () => {
  let service: CartService;
  let cartRepository: jest.Mocked<Repository<Cart>>;
  let cartItemRepository: jest.Mocked<Repository<CartItem>>;
  let variantRepository: jest.Mocked<Repository<BookFormatVariant>>;
  let bookRepository: jest.Mocked<Repository<Book>>;
  let redisService: jest.Mocked<RedisService>;
  let dataSource: jest.Mocked<DataSource>;

  const mockCart = {
    id: '123',
    userId: 1,
    status: CartStatus.ACTIVE,
    items: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockVariant = {
    id: 1,
    bookId: 'book-1',
    format: BookFormat.EBOOK,
    price: 19.99,
    stockQuantity: 100,
    reservedQuantity: 0,
    isAvailable: true,
  };

  const mockBook = {
    id: 'book-1',
    title: 'Test Book',
    visibility: 'public',
  };

  beforeEach(async () => {
    const mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: getRepositoryToken(Cart),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(CartItem),
          useValue: { ...mockRepository },
        },
        {
          provide: getRepositoryToken(BookFormatVariant),
          useValue: { ...mockRepository },
        },
        {
          provide: getRepositoryToken(Book),
          useValue: { ...mockRepository },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(),
            createQueryRunner: jest.fn(() => ({
              connect: jest.fn(),
              startTransaction: jest.fn(),
              commitTransaction: jest.fn(),
              rollbackTransaction: jest.fn(),
              release: jest.fn(),
              manager: {
                save: jest.fn(),
                findOne: jest.fn(),
              },
            })),
          },
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    cartRepository = module.get(getRepositoryToken(Cart));
    cartItemRepository = module.get(getRepositoryToken(CartItem));
    variantRepository = module.get(getRepositoryToken(BookFormatVariant));
    bookRepository = module.get(getRepositoryToken(Book));
    redisService = module.get(RedisService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCart', () => {
    it('should return cached cart if available', async () => {
      const cachedCart = { ...mockCart, items: [] };
      redisService.get.mockResolvedValue(JSON.stringify(cachedCart));

      const result = await service.getCart(1);

      expect(redisService.get).toHaveBeenCalledWith('cart:1');
      expect(result).toEqual(cachedCart);
      expect(cartRepository.findOne).not.toHaveBeenCalled();
    });

    it('should fetch from database if cache miss', async () => {
      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue(mockCart as any);

      const result = await service.getCart(1);

      expect(redisService.get).toHaveBeenCalledWith('cart:1');
      expect(cartRepository.findOne).toHaveBeenCalled();
      expect(redisService.set).toHaveBeenCalled();
    });

    it('should create new cart if none exists', async () => {
      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue(null);
      cartRepository.create.mockReturnValue(mockCart as any);
      cartRepository.save.mockResolvedValue(mockCart as any);

      const result = await service.getCart(1);

      expect(cartRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          status: CartStatus.ACTIVE,
        })
      );
      expect(cartRepository.save).toHaveBeenCalled();
    });
  });

  describe('addToCart', () => {
    it('should add new item to cart with stock reservation', async () => {
      const dto = { bookFormatVariantId: 1, qty: 2 };

      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue({ ...mockCart, items: [] } as any);
      variantRepository.findOne.mockResolvedValue(mockVariant as any);
      bookRepository.findOne.mockResolvedValue(mockBook as any);
      cartItemRepository.findOne.mockResolvedValue(null);
      cartItemRepository.create.mockReturnValue({ quantity: 2 } as any);
      cartItemRepository.save.mockResolvedValue({ quantity: 2 } as any);
      variantRepository.save.mockResolvedValue({ ...mockVariant, reservedQuantity: 2 } as any);

      await service.addToCart(1, dto);

      expect(variantRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reservedQuantity: 2 })
      );
      expect(redisService.del).toHaveBeenCalledWith('cart:1');
    });

    it('should increment quantity if item already exists', async () => {
      const dto = { bookFormatVariantId: 1, qty: 2 };
      const existingItem = { id: 'item-1', quantity: 3, variant: mockVariant };

      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue({ ...mockCart, items: [existingItem] } as any);
      variantRepository.findOne.mockResolvedValue(mockVariant as any);
      cartItemRepository.findOne.mockResolvedValue(existingItem as any);
      cartItemRepository.save.mockResolvedValue({ ...existingItem, quantity: 5 } as any);
      variantRepository.save.mockResolvedValue({ ...mockVariant, reservedQuantity: 2 } as any);

      await service.addToCart(1, dto);

      expect(cartItemRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 5 })
      );
    });

    it('should throw error if insufficient stock', async () => {
      const dto = { bookFormatVariantId: 1, qty: 200 };

      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue(mockCart as any);
      variantRepository.findOne.mockResolvedValue(mockVariant as any);

      await expect(service.addToCart(1, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw error if variant not found', async () => {
      const dto = { bookFormatVariantId: 999, qty: 1 };

      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue(mockCart as any);
      variantRepository.findOne.mockResolvedValue(null);

      await expect(service.addToCart(1, dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeFromCart', () => {
    it('should remove item and release stock reservation', async () => {
      const cartItem = {
        id: 'item-1',
        quantity: 3,
        variant: mockVariant,
        cart: mockCart,
      };

      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue({ ...mockCart, items: [cartItem] } as any);
      cartItemRepository.findOne.mockResolvedValue(cartItem as any);
      cartItemRepository.delete.mockResolvedValue({ affected: 1 } as any);
      variantRepository.save.mockResolvedValue({ ...mockVariant, reservedQuantity: -3 } as any);

      await service.removeFromCart(1, 'item-1');

      expect(cartItemRepository.delete).toHaveBeenCalledWith('item-1');
      expect(variantRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reservedQuantity: -3 })
      );
      expect(redisService.del).toHaveBeenCalledWith('cart:1');
    });

    it('should throw error if item not found', async () => {
      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue(mockCart as any);
      cartItemRepository.findOne.mockResolvedValue(null);

      await expect(service.removeFromCart(1, 'invalid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearCart', () => {
    it('should clear all items and release reservations', async () => {
      const items = [
        { id: '1', quantity: 2, variant: { ...mockVariant, id: 'v1' } },
        { id: '2', quantity: 3, variant: { ...mockVariant, id: 'v2' } },
      ];

      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue({ ...mockCart, items } as any);
      cartItemRepository.delete.mockResolvedValue({ affected: 2 } as any);

      await service.clearCart(1);

      expect(cartItemRepository.delete).toHaveBeenCalled();
      expect(variantRepository.save).toHaveBeenCalledTimes(2);
      expect(redisService.del).toHaveBeenCalledWith('cart:1');
    });
  });

  describe('updateCartItem', () => {
    it('should update item quantity and adjust reservation', async () => {
      const dto = { qty: 5 };
      const cartItem = {
        id: 'item-1',
        quantity: 3,
        variant: mockVariant,
        cart: mockCart,
      };

      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue({ ...mockCart, items: [cartItem] } as any);
      cartItemRepository.findOne.mockResolvedValue(cartItem as any);
      cartItemRepository.save.mockResolvedValue({ ...cartItem, quantity: 5 } as any);
      variantRepository.save.mockResolvedValue({ ...mockVariant, reservedQuantity: 2 } as any);

      await service.updateCartItem(1, 'item-1', dto);

      expect(cartItemRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 5 })
      );
      expect(variantRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reservedQuantity: 2 })
      );
      expect(redisService.del).toHaveBeenCalledWith('cart:1');
    });

    it('should throw error if new quantity exceeds stock', async () => {
      const dto = { qty: 200 };
      const cartItem = {
        id: 'item-1',
        quantity: 3,
        variant: mockVariant,
        cart: mockCart,
      };

      redisService.get.mockResolvedValue(null);
      cartRepository.findOne.mockResolvedValue(mockCart as any);
      cartItemRepository.findOne.mockResolvedValue(cartItem as any);

      await expect(service.updateCartItem(1, 'item-1', dto)).rejects.toThrow(BadRequestException);
    });
  });
});
