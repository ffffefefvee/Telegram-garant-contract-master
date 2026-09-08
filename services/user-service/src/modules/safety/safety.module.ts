import { Module } from "@nestjs/common";
import { SettlementCircuitBreakerService } from "./settlement-circuit-breaker.service";

@Module({
  providers: [SettlementCircuitBreakerService],
  exports: [SettlementCircuitBreakerService],
})
export class SafetyModule {}
