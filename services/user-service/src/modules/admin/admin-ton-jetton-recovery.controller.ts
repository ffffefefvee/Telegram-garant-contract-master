import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { TonJettonCursorRewindDto, TonJettonRequeueDto } from "../deal/ton-jetton-recovery.dto";
import { TonJettonRecoveryService } from "../deal/ton-jetton-recovery.service";
import type { VerifiedPrivilegedIdentity } from "../auth/privileged-identity.service";
import { Roles } from "./decorators/roles.decorator";
import { Role } from "./enums/role.enum";
import { RolesGuard } from "./guards/roles.guard";

@Controller("admin/ops/ton-jetton")
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminTonJettonRecoveryController {
  constructor(private readonly recovery: TonJettonRecoveryService) {}

  @Post("cursor-rewind-requests")
  requestCursor(@Body() input: TonJettonCursorRewindDto, @Req() request: Request) {
    return this.recovery.requestCursorRewind(input, this.actor(request));
  }

  @Post("cursor-rewind-requests/:requestId/approve")
  approveCursor(@Param("requestId", ParseUUIDPipe) requestId: string, @Req() request: Request) {
    return this.recovery.approveCursorRewind(requestId, this.actor(request));
  }

  @Post("manual-reviews/:eventId/requeue-requests")
  requestRequeue(@Param("eventId", ParseUUIDPipe) eventId: string,
    @Body() input: TonJettonRequeueDto, @Req() request: Request) {
    return this.recovery.requestRequeue(eventId, input.reasonCode, this.actor(request));
  }

  @Post("requeue-requests/:requestId/approve")
  approveRequeue(@Param("requestId", ParseUUIDPipe) requestId: string, @Req() request: Request) {
    return this.recovery.approveRequeue(requestId, this.actor(request));
  }

  @Post("recovery-requests/:requestId/cancel")
  cancel(@Param("requestId", ParseUUIDPipe) requestId: string, @Req() request: Request) {
    return this.recovery.cancel(requestId, this.actor(request));
  }

  private actor(request: Request) {
    const identity = (request as Request & { privilegedIdentity?: VerifiedPrivilegedIdentity }).privilegedIdentity;
    return { id: request.user!.id, role: Role.SUPER_ADMIN,
      jti: identity?.jti ?? "", sid: identity?.sid ?? "", scopes: identity?.scope ?? [] };
  }
}
