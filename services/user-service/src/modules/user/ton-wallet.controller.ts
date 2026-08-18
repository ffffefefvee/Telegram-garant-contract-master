import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import {
  TonProofChallengeResponse,
  TonWalletBindingResponse,
  VerifyTonWalletDto,
} from "./ton-wallet.dto";
import { TonWalletService } from "./ton-wallet.service";

@Controller("users/me/ton-wallet")
export class TonWalletController {
  constructor(private readonly tonWalletService: TonWalletService) {}

  /** Issue a short-lived nonce to pass as the TON Connect `tonProof` value. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("challenge")
  @HttpCode(HttpStatus.CREATED)
  issueChallenge(@Req() request: Request): Promise<TonProofChallengeResponse> {
    return this.tonWalletService.issueChallenge(this.requireUserId(request));
  }

  /** Verify TON wallet ownership and attach it to the authenticated account. */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("verify")
  @HttpCode(HttpStatus.OK)
  verify(
    @Req() request: Request,
    @Body() body: VerifyTonWalletDto,
  ): Promise<TonWalletBindingResponse> {
    return this.tonWalletService.verifyAndBind(
      this.requireUserId(request),
      body,
    );
  }

  @Get()
  getBinding(
    @Req() request: Request,
  ): Promise<TonWalletBindingResponse | null> {
    return this.tonWalletService.getBinding(this.requireUserId(request));
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  detach(@Req() request: Request): Promise<void> {
    return this.tonWalletService.detach(this.requireUserId(request));
  }

  private requireUserId(request: Request): string {
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException("Not authenticated");
    return userId;
  }
}
