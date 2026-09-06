import { TaxService } from './tax.service';

/**
 * Tax is INCLUSIVE: these numbers describe how an existing price splits, never
 * an amount added on top. The property that matters most is the last block —
 * whatever this service reports, the customer's total is unchanged.
 */
describe('TaxService', () => {
  const service = new TaxService();

  describe('lineTax', () => {
    /** ₹250 × 2 at 18% → 500 × 18 / 118 = 76.271... → ₹76.27 */
    it('extracts the tax contained in an inclusive line total', () => {
      expect(service.lineTax({ unitPrice: 250, quantity: 2, includeTax: true, taxPercentage: 18 })).toBe(76.27);
    });

    it('is the difference between the price and its pre-tax base', () => {
      const line = { unitPrice: 250, quantity: 2, includeTax: true, taxPercentage: 18 };
      const base = (250 * 2) / 1.18;

      expect(service.lineTax(line)).toBeCloseTo(500 - base, 2);
    });

    it('rounds to the two decimals the numeric(10,2) column stores', () => {
      // 99.99 at 5% → 4.761 → 4.76
      expect(service.lineTax({ unitPrice: 99.99, quantity: 1, includeTax: true, taxPercentage: 5 })).toBe(4.76);
    });

    describe('returns zero rather than a wrong or unsafe number', () => {
      it('when the line is not marked taxable', () => {
        expect(service.lineTax({ unitPrice: 250, quantity: 2, includeTax: false, taxPercentage: 18 })).toBe(0);
      });

      it('when includeTax is on but no rate was ever set', () => {
        expect(service.lineTax({ unitPrice: 250, quantity: 2, includeTax: true, taxPercentage: null })).toBe(0);
      });

      it('when the rate is zero or negative', () => {
        expect(service.lineTax({ unitPrice: 250, quantity: 1, includeTax: true, taxPercentage: 0 })).toBe(0);
        expect(service.lineTax({ unitPrice: 250, quantity: 1, includeTax: true, taxPercentage: -5 })).toBe(0);
      });

      it('when the rate is not a number', () => {
        expect(
          service.lineTax({ unitPrice: 250, quantity: 1, includeTax: true, taxPercentage: NaN }),
        ).toBe(0);
      });

      it('when the line total is zero', () => {
        expect(service.lineTax({ unitPrice: 0, quantity: 3, includeTax: true, taxPercentage: 18 })).toBe(0);
      });
    });
  });

  describe('totalTax', () => {
    it('sums only the taxable lines in a mixed basket', () => {
      const total = service.totalTax([
        { unitPrice: 250, quantity: 2, includeTax: true, taxPercentage: 18 }, // 76.27
        { unitPrice: 99, quantity: 1, includeTax: false, taxPercentage: 18 }, // untaxed ebook
        { unitPrice: 100, quantity: 1, includeTax: true, taxPercentage: 5 }, // 4.76
      ]);

      expect(total).toBe(81.03);
    });

    it('supports different rates on different lines', () => {
      expect(
        service.totalTax([
          { unitPrice: 100, quantity: 1, includeTax: true, taxPercentage: 18 }, // 15.25
          { unitPrice: 100, quantity: 1, includeTax: true, taxPercentage: 12 }, // 10.71
        ]),
      ).toBe(25.96);
    });

    /**
     * The itemised lines must add up to the printed total. Rounding once at the
     * end instead would let an invoice disagree with its own breakdown.
     */
    it('equals the sum of the per-line figures it reports', () => {
      const lines = [
        { unitPrice: 33.33, quantity: 3, includeTax: true, taxPercentage: 18 },
        { unitPrice: 66.67, quantity: 1, includeTax: true, taxPercentage: 5 },
        { unitPrice: 19.99, quantity: 7, includeTax: true, taxPercentage: 12 },
      ];
      const perLine = lines.map((line) => service.lineTax(line));
      const summed = Math.round(perLine.reduce((a, b) => a + b, 0) * 100) / 100;

      expect(service.totalTax(lines)).toBe(summed);
    });

    it('is zero for a basket with nothing taxable', () => {
      expect(service.totalTax([{ unitPrice: 99, quantity: 2, includeTax: false }])).toBe(0);
    });

    it('is zero for an empty or missing basket', () => {
      expect(service.totalTax([])).toBe(0);
      expect(service.totalTax(undefined as never)).toBe(0);
    });
  });

  describe('tax never changes what the customer pays', () => {
    /**
     * The defining property of the inclusive model, and the reason this feature
     * did not have to touch the Razorpay amount: the tax is always a slice of
     * the line total, never an addition to it.
     */
    it('is always less than the line total it was extracted from', () => {
      for (const rate of [1, 5, 12, 18, 28, 100]) {
        const lineTotal = 500;
        const tax = service.lineTax({ unitPrice: lineTotal, quantity: 1, includeTax: true, taxPercentage: rate });

        expect(tax).toBeGreaterThan(0);
        expect(tax).toBeLessThan(lineTotal);
      }
    });

    it('leaves a positive pre-tax base at the maximum allowed rate', () => {
      // 100% inclusive means half the price is tax — still not the whole price.
      expect(service.lineTax({ unitPrice: 200, quantity: 1, includeTax: true, taxPercentage: 100 })).toBe(100);
    });
  });

  describe('shippingTax', () => {
    it('is zero — shipping is not taxed', () => {
      expect(service.shippingTax()).toBe(0);
    });
  });
});
