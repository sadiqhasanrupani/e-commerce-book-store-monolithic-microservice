import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentSettlementService, SettlementOutcome } from './payment-settlement.service';
import { RazorpayProvider } from '../providers/razorpay.provider';
import { Transaction, TransactionStatus } from '@app/contract/orders/entities/transaction.entity';
import { PaymentProvider } from '@app/contract/carts/enums/payment-provider.enum';
import { PaymentStatus as ProviderPaymentStatus } from '../interfaces/payment-provider.interface';

describe('PaymentReconciliationService', () => {
  let service: PaymentReconciliationService;

  // Chainable query-builder stub; `getMany` is what the service ultimately awaits.
  const mockQueryBuilder: any = {
    leftJoinAndSelect: jest.fn(() => mockQueryBuilder),
    where: jest.fn(() => mockQueryBuilder),
    andWhere: jest.fn(() => mockQueryBuilder),
    orderBy: jest.fn(() => mockQueryBuilder),
    take: jest.fn(() => mockQueryBuilder),
    getMany: jest.fn(),
  };

  const mockTransactionRepository = { createQueryBuilder: jest.fn(() => mockQueryBuilder) };

  /** Flattens the SQL fragments + params the service passed to the builder. */
  const capturedConditions = () =>
    [...mockQueryBuilder.where.mock.calls, ...mockQueryBuilder.andWhere.mock.calls];
  const mockRazorpayProvider = { getPaymentStatus: jest.fn() };
  const mockSettlementService = {
    settleSuccess: jest.fn().mockResolvedValue(SettlementOutcome.PROCESSED),
    settleFailure: jest.fn().mockResolvedValue(SettlementOutcome.PROCESSED),
  };

  const pendingTxn = (overrides: Partial<Transaction> = {}) =>
    ({
      id: 'txn-uuid-1',
      gateway_ref_id: 'order_RZP1',
      status: TransactionStatus.PENDING,
      provider: PaymentProvider.RAZORPAY,
      order: { id: 1 },
      ...overrides,
    }) as Transaction;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSettlementService.settleSuccess.mockResolvedValue(SettlementOutcome.PROCESSED);
    mockSettlementService.settleFailure.mockResolvedValue(SettlementOutcome.PROCESSED);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentReconciliationService,
        { provide: getRepositoryToken(Transaction), useValue: mockTransactionRepository },
        { provide: RazorpayProvider, useValue: mockRazorpayProvider },
        { provide: PaymentSettlementService, useValue: mockSettlementService },
      ],
    }).compile();

    service = module.get<PaymentReconciliationService>(PaymentReconciliationService);
  });

  it('queries only PENDING Razorpay transactions that have a gateway reference', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([]);

    await service.handleCron();

    const conditions = capturedConditions();
    const sql = conditions.map(([fragment]) => fragment).join(' AND ');
    const params = Object.assign({}, ...conditions.map(([, values]) => values ?? {}));

    expect(sql).toContain('transaction.status = :status');
    expect(params.status).toBe(TransactionStatus.PENDING);
    // Razorpay, not PhonePe — the whole point of this job after roadmap #6.
    expect(params.provider).toBe(PaymentProvider.RAZORPAY);
    expect(params.provider).not.toBe('phonepe');
    expect(sql).toContain('transaction.gateway_ref_id IS NOT NULL');
    // Age window must be evaluated by the database (now()), never by the API
    // container's clock — see the comment in the service.
    expect(sql).toContain('now()');
    expect(params.minAge).toBe(5);
    expect(params.lookback).toBe(24);
  });

  it('settles a payment that succeeded at the gateway but whose webhook never arrived', async () => {
    const txn = pendingTxn();
    mockQueryBuilder.getMany.mockResolvedValue([txn]);
    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: txn.gateway_ref_id,
      status: ProviderPaymentStatus.SUCCESS,
      amount: 100,
    });

    await service.handleCron();

    // Polled by razorpay_order_id, the same key OrdersService.verifyOrder uses.
    expect(mockRazorpayProvider.getPaymentStatus).toHaveBeenCalledWith('order_RZP1');
    // Settlement runs through the shared service, so stock deduction and cart
    // completion happen exactly as they would for a delivered webhook.
    expect(mockSettlementService.settleSuccess).toHaveBeenCalledWith('txn-uuid-1', {
      reconciliation: expect.objectContaining({ status: ProviderPaymentStatus.SUCCESS }),
    });
    expect(mockSettlementService.settleFailure).not.toHaveBeenCalled();
  });

  it('leaves genuinely unpaid transactions alone', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([pendingTxn()]);
    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: 'order_RZP1',
      status: ProviderPaymentStatus.PENDING,
      amount: 100,
    });

    await service.handleCron();

    expect(mockSettlementService.settleSuccess).not.toHaveBeenCalled();
    expect(mockSettlementService.settleFailure).not.toHaveBeenCalled();
  });

  it('records a definitive gateway failure', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([pendingTxn()]);
    mockRazorpayProvider.getPaymentStatus.mockResolvedValue({
      transactionId: 'order_RZP1',
      status: ProviderPaymentStatus.FAILED,
      amount: 100,
    });

    await service.handleCron();

    expect(mockSettlementService.settleFailure).toHaveBeenCalledWith('txn-uuid-1', expect.any(Object));
  });

  it('keeps processing the batch when one transaction throws', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([
      pendingTxn({ id: 'txn-bad', gateway_ref_id: 'order_BAD' }),
      pendingTxn({ id: 'txn-good', gateway_ref_id: 'order_GOOD' }),
    ]);
    mockRazorpayProvider.getPaymentStatus.mockImplementation((ref: string) => {
      if (ref === 'order_BAD') return Promise.reject(new Error('Razorpay 503'));
      return Promise.resolve({ transactionId: ref, status: ProviderPaymentStatus.SUCCESS, amount: 100 });
    });

    await expect(service.handleCron()).resolves.not.toThrow();

    expect(mockSettlementService.settleSuccess).toHaveBeenCalledTimes(1);
    expect(mockSettlementService.settleSuccess).toHaveBeenCalledWith('txn-good', expect.any(Object));
  });
});
