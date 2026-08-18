import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { UserType } from "../user/entities/user.entity";
import {
  TonNativeManualReviewNoteDto,
  TonNativeManualReviewQueryDto,
  TonNativeBackfillDto,
  TonNativeRejectedEventQueryDto,
  TonNativeRequeueEventDto,
  TonNativeWatchQueryDto,
} from "../deal/ton-native-recovery.dto";
import { TonNativeRecoveryService } from "../deal/ton-native-recovery.service";
import { TonNativeBackfillService } from "../deal/ton-native-backfill.service";
import { Roles } from "./decorators/roles.decorator";
import { Role } from "./enums/role.enum";
import { RolesGuard } from "./guards/roles.guard";

@Controller("admin/ops/ton-native")
@UseGuards(RolesGuard)
export class AdminTonNativeRecoveryController {
  constructor(
    private readonly recovery: TonNativeRecoveryService,
    private readonly backfill: TonNativeBackfillService,
  ) {}

  @Get("rejected-events")
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  listRejected(@Query() query: TonNativeRejectedEventQueryDto) {
    return this.recovery.listRejectedEvents(query);
  }

  @Get("rejected-events/:eventId")
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  getRejected(@Param("eventId", ParseUUIDPipe) eventId: string) {
    return this.recovery.getRejectedEvent(eventId);
  }

  @Get("watches")
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  listWatches(@Query() query: TonNativeWatchQueryDto) {
    return this.recovery.listWatches(query);
  }

  @Post("watches/:watchId/backfill")
  @Roles(Role.SUPER_ADMIN)
  runBackfill(
    @Param("watchId", ParseUUIDPipe) watchId: string,
    @Body() body: TonNativeBackfillDto,
    @Req() request: Request,
  ) {
    return this.backfill.run(
      watchId,
      { id: request.user!.id, role: Role.SUPER_ADMIN },
      body,
    );
  }

  @Get("manual-reviews")
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  list(@Query() query: TonNativeManualReviewQueryDto) {
    return this.recovery.listManualReviews(query);
  }

  @Get("manual-reviews/:eventId")
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  get(@Param("eventId", ParseUUIDPipe) eventId: string) {
    return this.recovery.getManualReview(eventId);
  }

  @Post("manual-reviews/:eventId/keep-blocked")
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  keepBlocked(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body() body: TonNativeManualReviewNoteDto,
    @Req() request: Request,
  ) {
    const isSuperAdmin = request.user!.roles.includes(UserType.SUPER_ADMIN);
    return this.recovery.keepBlocked(
      eventId,
      {
        id: request.user!.id,
        role: isSuperAdmin ? Role.SUPER_ADMIN : Role.ADMIN,
      },
      body.reason,
    );
  }

  @Post("manual-reviews/:eventId/requeue-requests")
  @Roles(Role.SUPER_ADMIN)
  requestRequeue(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body() body: TonNativeRequeueEventDto,
    @Req() request: Request,
  ) {
    return this.recovery.requestRequeue(
      eventId,
      { id: request.user!.id, role: Role.SUPER_ADMIN },
      body,
    );
  }

  @Post("manual-reviews/:eventId/requeue-requests/:requestId/approve")
  @Roles(Role.SUPER_ADMIN)
  approveRequeue(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Req() request: Request,
  ) {
    return this.recovery.approveRequeue(eventId, requestId, {
      id: request.user!.id,
      role: Role.SUPER_ADMIN,
    });
  }

  @Post("manual-reviews/:eventId/requeue-requests/:requestId/cancel")
  @Roles(Role.SUPER_ADMIN)
  cancelRequeue(
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() body: TonNativeManualReviewNoteDto,
    @Req() request: Request,
  ) {
    return this.recovery.cancelRequeue(
      eventId,
      requestId,
      { id: request.user!.id, role: Role.SUPER_ADMIN },
      body.reason,
    );
  }
}
