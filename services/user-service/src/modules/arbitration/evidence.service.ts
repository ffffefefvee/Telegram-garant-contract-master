import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Evidence } from "./entities/evidence.entity";
import { Dispute } from "./entities/dispute.entity";
import { User } from "../user/entities/user.entity";
import { UserType } from "../user/entities/user.entity";
import { EvidenceType } from "./entities/enums/arbitration.enum";
import { SubmitEvidenceDto } from "./dto";
import { ArbitrationSettingsService } from "./arbitration-settings.service";
import { DisputeService } from "./dispute.service";

/**
 * Сервис для управления доказательствами
 */
@Injectable()
export class EvidenceService {
  constructor(
    @InjectRepository(Evidence)
    private readonly evidenceRepository: Repository<Evidence>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly settingsService: ArbitrationSettingsService,
    private readonly disputeService: DisputeService,
  ) {}

  /**
   * Загрузить доказательство
   */
  async submitEvidence(
    disputeId: string,
    userId: string,
    dto: SubmitEvidenceDto,
  ): Promise<Evidence> {
    if (dto.type === EvidenceType.FILE || dto.filePath || dto.fileHash) {
      throw new ForbiddenException(
        "File evidence must use the managed upload pipeline",
      );
    }
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
      relations: ["deal"],
    });

    if (!dispute) {
      throw new NotFoundException("Dispute not found");
    }

    if (dispute.isClosed) {
      throw new ForbiddenException("Cannot submit evidence to closed dispute");
    }

    // Проверка что пользователь является стороной спора или арбитром
    const isParty =
      dispute.openerId === userId ||
      dispute.deal?.buyerId === userId ||
      dispute.deal?.sellerId === userId ||
      dispute.arbitratorId === userId;

    if (!isParty) {
      throw new ForbiddenException(
        "You cannot submit evidence to this dispute",
      );
    }

    // Проверка лимита доказательств
    const maxEvidence = await this.settingsService.getMaxEvidencePerDispute();
    const existingCount = await this.evidenceRepository.count({
      where: { disputeId },
    });

    if (existingCount >= maxEvidence) {
      throw new ForbiddenException(
        `Maximum evidence limit reached: ${maxEvidence}`,
      );
    }

    // Валидация размера файла если есть
    if (dto.fileSize) {
      const maxSizeMb = await this.settingsService.getMaxEvidenceFileSizeMb();
      const maxSizeBytes = maxSizeMb * 1024 * 1024;

      if (dto.fileSize > maxSizeBytes) {
        throw new PayloadTooLargeException(
          `File size exceeds maximum: ${maxSizeMb}MB`,
        );
      }
    }

    // Валидация типа файла если есть
    if (dto.fileType) {
      const allowedTypes = await this.settingsService.getAllowedFileTypes();
      const isAllowed = allowedTypes.some((type) =>
        dto.fileType?.startsWith(type),
      );

      if (!isAllowed) {
        throw new UnsupportedMediaTypeException(
          `File type not allowed. Allowed types: ${allowedTypes.join(", ")}`,
        );
      }
    }

    const evidence = this.evidenceRepository.create({
      disputeId,
      submittedById: userId,
      type: dto.type,
      description: dto.description,
      content: dto.content,
      fileName: dto.fileName,
      filePath: dto.filePath,
      fileType: dto.fileType,
      fileSize: dto.fileSize,
      fileHash: dto.fileHash,
    });

    return this.evidenceRepository.save(evidence);
  }

  /**
   * Загрузить файл как доказательство
   */
  async uploadFileEvidence(
    _disputeId: string,
    _userId: string,
    _file: Express.Multer.File,
    _description: string,
    _type: EvidenceType,
  ): Promise<Evidence> {
    // Never acknowledge a file unless a durable, scanned object-storage
    // pipeline is configured. The former in-memory path produced a database
    // key while silently discarding the submitted bytes.
    throw new ServiceUnavailableException(
      "Evidence file uploads are disabled until managed storage is configured",
    );
  }

  /**
   * Получить доказательство
   */
  async getEvidence(
    evidenceId: string,
    userId: string,
    roles: UserType[] = [],
  ): Promise<Evidence> {
    const evidence = await this.evidenceRepository.findOne({
      where: { id: evidenceId },
      relations: ["dispute", "submittedBy"],
    });

    if (!evidence) {
      throw new NotFoundException("Evidence not found");
    }

    await this.disputeService.getDisputeForUser(
      evidence.disputeId,
      userId,
      roles,
    );
    return evidence;
  }

  /**
   * Получить все доказательства спора
   */
  async getDisputeEvidence(
    disputeId: string,
    userId: string,
    roles: UserType[] = [],
  ): Promise<Evidence[]> {
    await this.disputeService.getDisputeForUser(disputeId, userId, roles);
    return this.evidenceRepository.find({
      where: { disputeId },
      relations: ["submittedBy"],
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Верифицировать доказательство (арбитр)
   */
  async verifyEvidence(evidenceId: string, userId: string): Promise<Evidence> {
    const evidence = await this.getEvidence(evidenceId, userId);

    // Проверка что пользователь арбитр этого спора
    if (evidence.dispute.arbitratorId !== userId) {
      throw new ForbiddenException(
        "Only dispute arbitrator can verify evidence",
      );
    }

    evidence.markAsVerified(userId);
    return this.evidenceRepository.save(evidence);
  }

  /**
   * Удалить доказательство (только своё пока спор не закрыт)
   */
  async deleteEvidence(evidenceId: string, userId: string): Promise<void> {
    const evidence = await this.getEvidence(evidenceId, userId);

    if (!evidence.canBeDeleted) {
      throw new ForbiddenException("Evidence cannot be deleted");
    }

    if (evidence.submittedById !== userId) {
      throw new ForbiddenException("You can only delete your own evidence");
    }

    await this.evidenceRepository.remove(evidence);
  }

  /**
   * Increment view count
   */
  async incrementViewCount(
    evidenceId: string,
    userId: string,
    roles: UserType[] = [],
  ): Promise<Evidence> {
    const evidence = await this.getEvidence(evidenceId, userId, roles);
    evidence.incrementViewCount();
    return this.evidenceRepository.save(evidence);
  }

  /**
   * Получить доказательства пользователя
   */
  async getUserEvidence(userId: string): Promise<Evidence[]> {
    return this.evidenceRepository.find({
      where: { submittedById: userId },
      relations: ["dispute"],
      order: { createdAt: "DESC" },
    });
  }
}
