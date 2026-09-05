import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { Order } from '@app/contract/orders/entities/order.entity';
import { FulfillmentStatus } from '@app/contract/orders/enums/order-status.enum';

import { PhysicalFulfillmentService } from './physical-fulfillment.service';
import { MailService } from '../../mail/mail.service';

const ORDER_ID = 42;
const BUYER_EMAIL = 'buyer@example.com';

/**
 * The post-commit dispatch half of physical fulfilment.
 *
 * `markProcessing` (the in-transaction half) is exercised end-to-end against
 * settlement in `payment-settlement.service.spec.ts`, where the handshake
 * between the two actually lives. What is tested here is the part settlement
 * cannot see: which transitions produce which e-mail, and that a mail failure
 * stays contained.
 */
describe('PhysicalFulfillmentService', () => {
  let service: PhysicalFulfillmentService;
  let mailService: {
    sendOrderConfirmationEmail: jest.Mock;
    sendOrderShippedEmail: jest.Mock;
    sendOrderDeliveredEmail: jest.Mock;
  };

  let orderRow: any;

  const orderRepository = { findOne: jest.fn() };
  const dataSource = { getRepository: jest.fn(() => orderRepository) };

  beforeEach(async () => {
    jest.clearAllMocks();

    orderRow = {
      id: ORDER_ID,
      carrier: 'Delhivery',
      tracking_number: 'AWB123',
      tracking_url: 'https://track.example.com/AWB123',
      user: { id: 7, email: BUYER_EMAIL, firstName: 'Ada' },
    };

    orderRepository.findOne.mockResolvedValue(orderRow);
    dataSource.getRepository.mockReturnValue(orderRepository);

    mailService = {
      sendOrderConfirmationEmail: jest.fn().mockResolvedValue(undefined),
      sendOrderShippedEmail: jest.fn().mockResolvedValue(undefined),
      sendOrderDeliveredEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhysicalFulfillmentService,
        { provide: DataSource, useValue: dataSource },
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: () => 'https://storefront.test' } },
      ],
    }).compile();

    service = module.get<PhysicalFulfillmentService>(PhysicalFulfillmentService);
  });

  describe('dispatchShipmentUpdate', () => {
    it('sends the shipped e-mail with the stored carrier and tracking details', async () => {
      await service.dispatchShipmentUpdate(ORDER_ID, FulfillmentStatus.SHIPPED);

      expect(mailService.sendOrderShippedEmail).toHaveBeenCalledTimes(1);
      const [email, name, orderNumber, carrier, trackingNumber, trackingUrl, orderUrl] = mailService
        .sendOrderShippedEmail.mock.calls[0] as string[];

      expect(email).toBe(BUYER_EMAIL);
      expect(name).toBe('Ada');
      expect(orderNumber).toBe('MP-000042');
      expect(carrier).toBe('Delhivery');
      expect(trackingNumber).toBe('AWB123');
      expect(trackingUrl).toBe('https://track.example.com/AWB123');
      // Points at the storefront order page, never at a raw object-storage URL.
      expect(orderUrl).toBe('https://storefront.test/orders?order=42');
      expect(mailService.sendOrderDeliveredEmail).not.toHaveBeenCalled();
    });

    it('sends the delivered e-mail on DELIVERED', async () => {
      await service.dispatchShipmentUpdate(ORDER_ID, FulfillmentStatus.DELIVERED);

      expect(mailService.sendOrderDeliveredEmail).toHaveBeenCalledTimes(1);
      expect(mailService.sendOrderShippedEmail).not.toHaveBeenCalled();
    });

    /**
     * PROCESSING is an internal queue move. The buyer was already told the
     * order was received at settlement, so a second "we have your order" would
     * be noise. `OrdersService` hands every transition here unconditionally and
     * relies on this filter.
     */
    it.each([FulfillmentStatus.PROCESSING, FulfillmentStatus.NOT_STARTED, FulfillmentStatus.CANCELLED])(
      'sends nothing for %s',
      async (status) => {
        await service.dispatchShipmentUpdate(ORDER_ID, status);

        expect(mailService.sendOrderShippedEmail).not.toHaveBeenCalled();
        expect(mailService.sendOrderDeliveredEmail).not.toHaveBeenCalled();
        // Not even a database read: nothing to do is decided before the query.
        expect(orderRepository.findOne).not.toHaveBeenCalled();
      },
    );

    /**
     * The parcel has physically moved and the status change is already
     * committed. Throwing here would turn a correct state change into a 500 and
     * tempt the admin into clicking again.
     */
    it('never throws when the mail transport is down', async () => {
      mailService.sendOrderShippedEmail.mockRejectedValue(new Error('SMTP unavailable'));

      await expect(service.dispatchShipmentUpdate(ORDER_ID, FulfillmentStatus.SHIPPED)).resolves.toBeUndefined();
    });

    it('never throws when the order has no recipient address', async () => {
      orderRepository.findOne.mockResolvedValue({ id: ORDER_ID, user: null });

      await expect(service.dispatchShipmentUpdate(ORDER_ID, FulfillmentStatus.SHIPPED)).resolves.toBeUndefined();
      expect(mailService.sendOrderShippedEmail).not.toHaveBeenCalled();
    });
  });

  describe('dispatchOrderConfirmation', () => {
    it('sends nothing for an unclaimed order', async () => {
      await service.dispatchOrderConfirmation({ orderId: ORDER_ID, claimed: false });

      expect(mailService.sendOrderConfirmationEmail).not.toHaveBeenCalled();
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('sends the confirmation for a claimed order', async () => {
      await service.dispatchOrderConfirmation({ orderId: ORDER_ID, claimed: true });

      expect(mailService.sendOrderConfirmationEmail).toHaveBeenCalledWith(
        BUYER_EMAIL,
        'Ada',
        'MP-000042',
        'https://storefront.test/orders?order=42',
      );
    });

    it('never throws when the mail transport is down', async () => {
      mailService.sendOrderConfirmationEmail.mockRejectedValue(new Error('SMTP unavailable'));

      await expect(service.dispatchOrderConfirmation({ orderId: ORDER_ID, claimed: true })).resolves.toBeUndefined();
    });
  });

  describe('markProcessing', () => {
    const manager = { update: jest.fn(), save: jest.fn() };

    beforeEach(() => {
      manager.update.mockResolvedValue({ affected: 1 });
      manager.save.mockResolvedValue(undefined);
    });

    const orderWith = (formats: string[]): Order =>
      ({
        id: ORDER_ID,
        fulfillment_status: FulfillmentStatus.NOT_STARTED,
        items: formats.map((format, index) => ({ id: index, bookFormatVariant: { id: index, format } })),
      }) as unknown as Order;

    it('claims an order that has a physical line', async () => {
      const order = orderWith(['paperback', 'ebook']);

      const claim = await service.markProcessing(manager as any, order);

      expect(claim).toEqual({ orderId: ORDER_ID, claimed: true });
      // Conditional on NOT_STARTED — that predicate is the idempotency gate.
      expect(manager.update).toHaveBeenCalledWith(
        Order,
        { id: ORDER_ID, fulfillment_status: FulfillmentStatus.NOT_STARTED },
        { fulfillment_status: FulfillmentStatus.PROCESSING },
      );
      // The in-memory entity is kept honest, so a later full-entity save by the
      // caller cannot write the claim back out.
      expect(order.fulfillment_status).toBe(FulfillmentStatus.PROCESSING);
    });

    it('claims nothing for a digital-only order', async () => {
      const claim = await service.markProcessing(manager as any, orderWith(['ebook', 'audiobook']));

      expect(claim.claimed).toBe(false);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('claims nothing when the conditional UPDATE matched no row', async () => {
      manager.update.mockResolvedValue({ affected: 0 });

      const claim = await service.markProcessing(manager as any, orderWith(['hardcover']));

      expect(claim.claimed).toBe(false);
      // No audit row for a transition that did not happen.
      expect(manager.save).not.toHaveBeenCalled();
    });
  });
});
