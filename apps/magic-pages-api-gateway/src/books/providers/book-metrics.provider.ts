import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { BookMetric } from '@app/contract/books/entities/book-metrics.entity';
import { subDays } from 'date-fns';

interface MetricsFilterOptions {
  startDate?: Date;
  endDate?: Date;
  genre?: string;
  authorName?: string;
  limit?: number;
}

@Injectable()
export class BoookMetricsProvider {
  private readonly logger = new Logger(BoookMetricsProvider.name);

  constructor(
    @InjectRepository(BookMetric)
    private readonly metricsRepository: Repository<BookMetric>,
  ) { }

  /**
   * Record an analytic event (view, purchase, wishlist, etc.)
   *
   * System Design Notes:
   * - Designed for high write throughput; use queue or batch writes in production.
   * - Later this can publish to Kafka/NATS for async aggregation.
   */
  async recordEvent(
    bookId: string,
    event: 'view' | 'purchase' | 'wishlist' | 'download' | 'rating',
    value?: number,
  ): Promise<void> {
    try {
      let metric = await this.metricsRepository.findOne({ where: { id: bookId } });
      if (!metric) {
        metric = this.metricsRepository.create({ id: bookId });
      }

      switch (event) {
        case 'view':
          metric.views += 1;
          metric.lastViewedAt = new Date();
          break;
        case 'purchase':
          metric.purchases += 1;
          metric.lastPurchasedAt = new Date();
          break;
        case 'wishlist':
          metric.wishlistAdds += 1;
          break;
        case 'download':
          metric.downloads += 1;
          break;
        case 'rating':
          if (value && value >= 0 && value <= 5) {
            metric.totalRatings += 1;
            metric.averageRating = (metric.averageRating * (metric.totalRatings - 1) + value) / metric.totalRatings;
          }
          break;
        default:
          throw new BadRequestException(`Unsupported event: ${event}`);
      }

      await this.metricsRepository.save(metric);
      this.logger.debug(`BookMetrics updated: ${event} → bookId=${bookId}`);
    } catch (err) {
      this.logger.error(`Failed to record book metric: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Error recording book metrics');
    }
  }

  /**
   * Get aggregated metrics for a single book
   */
  async getBookMetrics(bookId: number): Promise<BookMetrics> {
    const metric = await this.metricsRepository.findOne({ where: { bookId } });
    if (!metric) {
      throw new BadRequestException(`No metrics found for bookId ${bookId}`);
    }
    return metric;
  }

  /**
   * Top Performing Books
   * -------------------------
   * Returns books ranked by engagement (views/purchases/downloads)
   * over a configurable time window and filter criteria.
   */
  async getTopBooksByMetric(metric: keyof BookMetrics, options: MetricsFilterOptions = {}): Promise<BookMetrics[]> {
    const { startDate, endDate, genre, authorName, limit = 10 } = options;

    try {
      const where: any = {};
      if (startDate && endDate) {
        where.updatedAt = Between(startDate, endDate);
      }

      const qb = this.metricsRepository
        .createQueryBuilder('metric')
        .innerJoinAndSelect('metric.book', 'book')
        .where(where)
        .andWhere('book.deletedAt IS NULL')
        .andWhere('book.isArchived = false')
        .andWhere('book.visibility = :visibility', { visibility: 'public' });

      if (genre) qb.andWhere('book.genre = :genre', { genre });
      if (authorName)
        qb.andWhere('LOWER(book.authorName) LIKE :authorName', {
          authorName: `%${authorName.toLowerCase()}%`,
        });

      qb.orderBy(`metric.${metric}`, 'DESC').limit(limit);

      return await qb.getMany();
    } catch (err) {
      this.logger.error(`Failed to fetch top books by ${metric}`, err.stack);
      throw new InternalServerErrorException('Failed to retrieve book metrics');
    }
  }

  /**
   * Trending Books Analysis
   * ----------------------------
   * Computes relative growth in views or purchases between
   * two time windows to determine trending titles.
   *
   * Example:
   *   - Compare last 7 days vs previous 7 days view count growth.
   */
  async getTrendingBooks(metric: 'views' | 'purchases', days = 7): Promise<any[]> {
    const now = new Date();
    const currentStart = subDays(now, days);
    const previousStart = subDays(currentStart, days);

    const currentMetrics = await this.metricsRepository
      .createQueryBuilder('metric')
      .select('metric.bookId', 'bookId')
      .addSelect(`SUM(metric.${metric})`, 'currentTotal')
      .where('metric.updatedAt BETWEEN :start AND :end', {
        start: currentStart,
        end: now,
      })
      .groupBy('metric.bookId')
      .getRawMany();

    const previousMetrics = await this.metricsRepository
      .createQueryBuilder('metric')
      .select('metric.bookId', 'bookId')
      .addSelect(`SUM(metric.${metric})`, 'previousTotal')
      .where('metric.updatedAt BETWEEN :start AND :end', {
        start: previousStart,
        end: currentStart,
      })
      .groupBy('metric.bookId')
      .getRawMany();

    const growthMap = new Map<number, number>();
    previousMetrics.forEach((m) => growthMap.set(Number(m.bookId), Number(m.previousTotal) || 0));

    // compute growth %
    return currentMetrics
      .map((m) => {
        const prev = growthMap.get(Number(m.bookId)) || 0;
        const growth = prev === 0 ? 100 : ((m.currentTotal - prev) / prev) * 100;
        return { bookId: Number(m.bookId), growth: Number(growth.toFixed(2)) };
      })
      .sort((a, b) => b.growth - a.growth)
      .slice(0, 10);
  }

  /**
   * Get genre-level aggregation metrics
   * -------------------------------------
   * Useful for dashboards showing category performance.
   */
  async getGenrePerformance(): Promise<
    Array<{ genre: string; totalViews: number; totalPurchases: number; avgRating: number }>
  > {
    const qb = this.metricsRepository
      .createQueryBuilder('metric')
      .innerJoin('metric.book', 'book')
      .select('book.genre', 'genre')
      .addSelect('SUM(metric.views)', 'totalViews')
      .addSelect('SUM(metric.purchases)', 'totalPurchases')
      .addSelect('AVG(metric.averageRating)', 'avgRating')
      .groupBy('book.genre')
      .orderBy('totalPurchases', 'DESC');

    return await qb.getRawMany();
  }
}
