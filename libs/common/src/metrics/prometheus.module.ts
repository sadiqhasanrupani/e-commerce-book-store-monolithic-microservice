import { Module } from '@nestjs/common';
import { PrometheusModule as NestPrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    NestPrometheusModule.register({
      defaultMetrics: {
        enabled: true,
      },
      path: '/metrics',
      defaultLabels: {
        app: 'magic-pages-api-gateway',
      },
    }),
  ],
  exports: [NestPrometheusModule],
})
export class PrometheusModule { }
