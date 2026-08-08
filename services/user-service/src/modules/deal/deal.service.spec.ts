import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { DealService } from "./deal.service";

function makeQuery() {
  const query: any = {
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(async () => [[], 0]),
  };
  return query;
}

describe("DealService list access policy", () => {
  let query: ReturnType<typeof makeQuery>;
  let service: DealService;

  beforeEach(() => {
    query = makeQuery();
    service = new DealService(
      { createQueryBuilder: jest.fn(() => query) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it("rejects an attempt to list another user's deals", async () => {
    await expect(
      service.findMany({ userId: "victim-id" }, "caller-id"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects an unrecognised sort field instead of interpolating it into SQL", async () => {
    await expect(
      service.findMany(
        { sortBy: "amount; DROP TABLE deals" as any },
        "caller-id",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("uses the allowlisted sort column and bounded pagination", async () => {
    await service.findMany(
      { sortBy: "amount", sortOrder: "ASC", limit: 1000, offset: 20_000 },
      "caller-id",
    );

    expect(query.orderBy).toHaveBeenCalledWith("deal.amount", "ASC");
    expect(query.take).toHaveBeenCalledWith(100);
    expect(query.skip).toHaveBeenCalledWith(10_000);
  });
});
