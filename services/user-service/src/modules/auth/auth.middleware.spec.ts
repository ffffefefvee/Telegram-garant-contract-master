import { UnauthorizedException } from "@nestjs/common";
import { RequireAuthMiddleware } from "./auth.middleware";

describe("RequireAuthMiddleware durable sessions", () => {
  const auth = {
    verifyToken: jest.fn(),
  };
  const users = {
    findById: jest.fn(),
    findSessionById: jest.fn(),
  };
  const middleware = new RequireAuthMiddleware(auth as any, users as any);

  beforeEach(() => {
    jest.clearAllMocks();
    auth.verifyToken.mockReturnValue({
      sub: "user-1",
      tg: 1,
      sid: "session-1",
    });
    users.findById.mockResolvedValue({
      id: "user-1",
      telegramId: 1,
      telegramUsername: "alice",
      telegramLanguageCode: "en",
      roles: ["buyer"],
    });
    users.findSessionById.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      isValid: true,
    });
  });

  function request() {
    return { headers: { authorization: "Bearer signed-token" } } as any;
  }

  it("attaches a principal only when the durable session is active", async () => {
    const req = request();
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(req.user).toEqual(
      expect.objectContaining({ id: "user-1", sessionId: "session-1" }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects a legacy JWT without a server-side session id", async () => {
    auth.verifyToken.mockReturnValue({ sub: "user-1", tg: 1 });
    await expect(
      middleware.use(request(), {} as any, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it("rejects revoked, expired or cross-user sessions", async () => {
    users.findSessionById.mockResolvedValue({
      id: "session-1",
      userId: "user-2",
      isValid: true,
    });
    await expect(
      middleware.use(request(), {} as any, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);

    users.findSessionById.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      isValid: false,
    });
    await expect(
      middleware.use(request(), {} as any, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
  });
});
