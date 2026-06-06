import { Controller, Get } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';

/**
 * Public-style metrics for scrapers (no auth). In production, protect via
 * reverse-proxy or `METRICS_TOKEN` header check.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  async getMetrics() {
    return this.monitoring.getPrometheusStyleMetrics();
  }
}
