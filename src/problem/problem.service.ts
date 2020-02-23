import { Injectable } from "@nestjs/common";
import { InjectConnection, InjectRepository } from "@nestjs/typeorm";
import { Connection, Repository, FindConditions, FindManyOptions, EntityManager } from "typeorm";

import { UserEntity } from "@/user/user.entity";
import { GroupEntity } from "@/group/group.entity";
import { LocalizedContentService } from "@/localized-content/localized-content.service";
import { ProblemEntity, ProblemType } from "./problem.entity";
import { ProblemJudgeInfoEntity } from "./problem-judge-info.entity";
import { ProblemSampleEntity } from "./problem-sample.entity";
import { ProblemFileType, ProblemFileEntity } from "./problem-file.entity";
import { ProblemTagEntity } from "./problem-tag.entity";
import { ProblemTagMapEntity } from "./problem-tag-map.entity";
import { ProblemJudgeInfoService } from "./type/problem-judge-info.service";
import {
  ProblemStatementDto,
  UpdateProblemStatementRequestDto,
  ProblemLocalizedContentDto,
  ProblemFileDto,
  ProblemMetaDto,
  LocalizedProblemTagDto
} from "./dto";
import { LocalizedContentType } from "@/localized-content/localized-content.entity";
import { Locale } from "@/common/locale.type";
import { ProblemContentSection } from "./problem-content.interface";
import { ProblemSampleData } from "./problem-sample-data.interface";
import { ProblemJudgeInfo } from "./type/problem-judge-info.interface";
import { UserPrivilegeService, UserPrivilegeType } from "@/user/user-privilege.service";
import { PermissionService, PermissionObjectType } from "@/permission/permission.service";
import { UserService } from "@/user/user.service";
import { GroupService } from "@/group/group.service";
import { FileService } from "@/file/file.service";
import { ConfigService } from "@/config/config.service";
import { escapeLike } from "@/database/database.utils";

export enum ProblemPermissionType {
  VIEW = "VIEW",
  MODIFY = "MODIFY",
  MANAGE_PERMISSION = "MANAGE_PERMISSION",
  MANAGE_PUBLICNESS = "MANAGE_PUBLICNESS",
  DELETE = "DELETE"
}

export enum ProblemPermissionLevel {
  READ = 1,
  WRITE = 2
}

@Injectable()
export class ProblemService {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    @InjectRepository(ProblemEntity)
    private readonly problemRepository: Repository<ProblemEntity>,
    @InjectRepository(ProblemJudgeInfoEntity)
    private readonly problemJudgeInfoRepository: Repository<ProblemJudgeInfoEntity>,
    @InjectRepository(ProblemSampleEntity)
    private readonly problemSampleRepository: Repository<ProblemSampleEntity>,
    @InjectRepository(ProblemFileEntity)
    private readonly problemFileRepository: Repository<ProblemFileEntity>,
    @InjectRepository(ProblemTagEntity)
    private readonly problemTagRepository: Repository<ProblemTagEntity>,
    @InjectRepository(ProblemTagMapEntity)
    private readonly problemTagMapRepository: Repository<ProblemTagMapEntity>,
    private readonly problemJudgeInfoService: ProblemJudgeInfoService,
    private readonly localizedContentService: LocalizedContentService,
    private readonly userPrivilegeService: UserPrivilegeService,
    private readonly userService: UserService,
    private readonly groupService: GroupService,
    private readonly permissionService: PermissionService,
    private readonly fileService: FileService,
    private readonly configService: ConfigService
  ) {}

  async findProblemById(id: number): Promise<ProblemEntity> {
    return this.problemRepository.findOne(id);
  }

  public async findProblemsByExistingIds(problemIds: number[]): Promise<ProblemEntity[]> {
    if (problemIds.length === 0) return [];
    const uniqueIds = Array.from(new Set(problemIds));
    const records = await this.problemRepository.findByIds(uniqueIds);
    const map = Object.fromEntries(records.map(record => [record.id, record]));
    return problemIds.map(problemId => map[problemId]);
  }

  async findProblemByDisplayId(displayId: number): Promise<ProblemEntity> {
    return this.problemRepository.findOne({
      displayId: displayId
    });
  }

  async getProblemMeta(problem: ProblemEntity, includeStatistics?: boolean): Promise<ProblemMetaDto> {
    const meta: ProblemMetaDto = {
      id: problem.id,
      displayId: problem.displayId,
      type: problem.type,
      isPublic: problem.isPublic,
      ownerId: problem.ownerId,
      locales: problem.locales
    };

    if (includeStatistics) {
      meta.acceptedSubmissionCount = problem.acceptedSubmissionCount;
      meta.submissionCount = problem.submissionCount;
    }

    return meta;
  }

  async userHasPermission(user: UserEntity, problem: ProblemEntity, type: ProblemPermissionType): Promise<boolean> {
    switch (type) {
      // Everyone can read a public problem
      // Owner, admins and those who has read permission can view a non-public problem
      case ProblemPermissionType.VIEW:
        if (problem.isPublic) return true;
        else if (!user) return false;
        else if (user.id === problem.ownerId) return true;
        else if (user.isAdmin) return true;
        else if (await this.userPrivilegeService.userHasPrivilege(user, UserPrivilegeType.MANAGE_PROBLEM)) return true;
        else
          return await this.permissionService.userOrItsGroupsHavePermission(
            user,
            problem.id,
            PermissionObjectType.PROBLEM,
            ProblemPermissionLevel.READ
          );

      // Owner, admins and those who has write permission can modify a problem
      case ProblemPermissionType.MODIFY:
        if (!user) return false;
        else if (user.id === problem.ownerId) return true;
        else if (user.isAdmin) return true;
        else if (await this.userPrivilegeService.userHasPrivilege(user, UserPrivilegeType.MANAGE_PROBLEM)) return true;
        else
          return await this.permissionService.userOrItsGroupsHavePermission(
            user,
            problem.id,
            PermissionObjectType.PROBLEM,
            ProblemPermissionLevel.WRITE
          );

      // Admins can manage a problem's permission
      // Controlled by the application preference, the owner may have the permission
      case ProblemPermissionType.MANAGE_PERMISSION:
        if (!user) return false;
        else if (user.id === problem.ownerId && this.configService.config.preference.allowOwnerManageProblemPermission)
          return true;
        else if (user.isAdmin) return true;
        else if (await this.userPrivilegeService.userHasPrivilege(user, UserPrivilegeType.MANAGE_PROBLEM)) return true;
        else return false;

      // Admins can manage a problem's publicness (set display id / make public or non-public)
      case ProblemPermissionType.MANAGE_PUBLICNESS:
        if (!user) return false;
        else if (user.isAdmin) return true;
        else if (await this.userPrivilegeService.userHasPrivilege(user, UserPrivilegeType.MANAGE_PROBLEM)) return true;
        else return false;

      // Admins can delete a problem
      // Controlled by the application preference, the owner may have the permission
      case ProblemPermissionType.DELETE:
        if (!user) return false;
        else if (user.id === problem.ownerId && this.configService.config.preference.allowOwnerDeleteProblem)
          return true;
        else if (user.isAdmin) return true;
        else if (await this.userPrivilegeService.userHasPrivilege(user, UserPrivilegeType.MANAGE_PROBLEM)) return true;
        else return false;
    }
  }

  async userHasCreateProblemPermission(user: UserEntity): Promise<boolean> {
    if (!user) return false;
    if (this.configService.config.preference.allowEveryoneCreateProblem) return true;
    return await this.userPrivilegeService.userHasPrivilege(user, UserPrivilegeType.MANAGE_PROBLEM);
  }

  /**
   * Query problem set with pagination.
   *
   * If the user has manage problem privilege, show all problems.
   * If the user has no manage problem privilege, show only public and the user owned problems.
   *
   * Sort: problems with display ID first (by displayId asc), then without display ID (by id asc).
   */
  async queryProblemsAndCount(
    user: UserEntity,
    skipCount: number,
    takeCount: number
  ): Promise<[ProblemEntity[], number]> {
    const queryBuilder = this.problemRepository.createQueryBuilder().select();
    if (!(await this.userPrivilegeService.userHasPrivilege(user, UserPrivilegeType.MANAGE_PROBLEM))) {
      queryBuilder.where("isPublic = 1");
      if (user) queryBuilder.orWhere("ownerId = :ownerId", { ownerId: user.id });
    }
    queryBuilder
      .orderBy("displayId IS NOT NULL", "DESC")
      .addOrderBy("displayId", "ASC")
      .addOrderBy("id", "ASC");
    return await queryBuilder
      .skip(skipCount)
      .take(takeCount)
      .getManyAndCount();
  }

  async createProblem(
    owner: UserEntity,
    type: ProblemType,
    statement: ProblemStatementDto,
    tags: ProblemTagEntity[]
  ): Promise<ProblemEntity> {
    let problem: ProblemEntity;
    await this.connection.transaction("READ COMMITTED", async transactionalEntityManager => {
      problem = new ProblemEntity();
      problem.displayId = null;
      problem.type = type;
      problem.isPublic = false;
      problem.ownerId = owner.id;
      problem.locales = statement.localizedContents.map(localizedContent => localizedContent.locale);
      await transactionalEntityManager.save(problem);

      const problemJudgeInfo = new ProblemJudgeInfoEntity();
      problemJudgeInfo.problemId = problem.id;
      problemJudgeInfo.judgeInfo = this.problemJudgeInfoService.getDefaultJudgeInfo(type);
      await transactionalEntityManager.save(problemJudgeInfo);

      const problemSample = new ProblemSampleEntity();
      problemSample.problemId = problem.id;
      problemSample.data = statement.samples;
      await transactionalEntityManager.save(problemSample);

      for (const localizedContent of statement.localizedContents) {
        await this.localizedContentService.createOrUpdate(
          problem.id,
          LocalizedContentType.PROBLEM_TITLE,
          localizedContent.locale,
          localizedContent.title,
          transactionalEntityManager
        );
        await this.localizedContentService.createOrUpdate(
          problem.id,
          LocalizedContentType.PROBLEM_CONTENT,
          localizedContent.locale,
          JSON.stringify(localizedContent.contentSections),
          transactionalEntityManager
        );
      }

      await this.setProblemTags(problem, tags, transactionalEntityManager);
    });

    return problem;
  }

  async updateProblemStatement(
    problem: ProblemEntity,
    request: UpdateProblemStatementRequestDto,
    tags: ProblemTagEntity[]
  ): Promise<boolean> {
    await this.connection.transaction("READ COMMITTED", async transactionalEntityManager => {
      if (request.samples != null) {
        const problemSample = await transactionalEntityManager.findOne(ProblemSampleEntity, {
          problemId: problem.id
        });
        problemSample.data = request.samples;
        await transactionalEntityManager.save(problemSample);
      }

      const newLocales = request.localizedContents.map(localizedContent => localizedContent.locale);

      const deletingLocales = problem.locales.filter(locale => !newLocales.includes(locale));
      for (const deletingLocale of deletingLocales) {
        await this.localizedContentService.delete(
          problem.id,
          LocalizedContentType.PROBLEM_TITLE,
          deletingLocale,
          transactionalEntityManager
        );
        await this.localizedContentService.delete(
          problem.id,
          LocalizedContentType.PROBLEM_CONTENT,
          deletingLocale,
          transactionalEntityManager
        );
      }

      problem.locales = newLocales;

      for (const localizedContent of request.localizedContents) {
        // Update if not null
        if (localizedContent.title != null)
          await this.localizedContentService.createOrUpdate(
            problem.id,
            LocalizedContentType.PROBLEM_TITLE,
            localizedContent.locale,
            localizedContent.title
          );
        if (localizedContent.contentSections != null)
          await this.localizedContentService.createOrUpdate(
            problem.id,
            LocalizedContentType.PROBLEM_CONTENT,
            localizedContent.locale,
            JSON.stringify(localizedContent.contentSections)
          );
      }

      await this.setProblemTags(problem, tags, transactionalEntityManager);

      await transactionalEntityManager.save(problem);
    });

    return true;
  }

  async updateProblemJudgeInfo(problem: ProblemEntity, judgeInfo: ProblemJudgeInfo): Promise<void> {
    const problemJudgeInfo = await this.problemJudgeInfoRepository.findOne({
      problemId: problem.id
    });

    problemJudgeInfo.judgeInfo = judgeInfo;
    await this.problemJudgeInfoRepository.save(problemJudgeInfo);
  }

  async getProblemLocalizedTitle(problem: ProblemEntity, locale: Locale): Promise<string> {
    return await this.localizedContentService.get(problem.id, LocalizedContentType.PROBLEM_TITLE, locale);
  }

  async getProblemLocalizedContent(problem: ProblemEntity, locale: Locale): Promise<ProblemContentSection[]> {
    const data = await this.localizedContentService.get(problem.id, LocalizedContentType.PROBLEM_CONTENT, locale);
    if (data != null) return JSON.parse(data);
    else return null;
  }

  async getProblemAllLocalizedContents(problem: ProblemEntity): Promise<ProblemLocalizedContentDto[]> {
    const titles = await this.localizedContentService.getOfAllLocales(problem.id, LocalizedContentType.PROBLEM_TITLE);
    const contents = await this.localizedContentService.getOfAllLocales(
      problem.id,
      LocalizedContentType.PROBLEM_CONTENT
    );
    return Object.keys(titles).map((locale: Locale) => ({
      locale: locale,
      title: titles[locale],
      contentSections: JSON.parse(contents[locale])
    }));
  }

  async getProblemSamples(problem: ProblemEntity): Promise<ProblemSampleData> {
    const problemSample = await problem.sample;
    return problemSample.data;
  }

  async getProblemJudgeInfo(problem: ProblemEntity): Promise<ProblemJudgeInfo> {
    const problemJudgeInfo = await problem.judgeInfo;
    return problemJudgeInfo.judgeInfo;
  }

  async setProblemPermissions(
    problem: ProblemEntity,
    userPermissions: [UserEntity, ProblemPermissionLevel][],
    groupPermissions: [GroupEntity, ProblemPermissionLevel][]
  ): Promise<void> {
    await this.permissionService.replaceUsersAndGroupsPermissionForObject(
      problem.id,
      PermissionObjectType.PROBLEM,
      userPermissions,
      groupPermissions
    );
  }

  async getProblemPermissions(
    problem: ProblemEntity
  ): Promise<[[UserEntity, ProblemPermissionLevel][], [GroupEntity, ProblemPermissionLevel][]]> {
    const [
      userPermissionList,
      groupPermissionList
    ] = await this.permissionService.getUserAndGroupPermissionListOfObject<ProblemPermissionLevel>(
      problem.id,
      PermissionObjectType.PROBLEM
    );
    return [
      await Promise.all(
        userPermissionList.map(
          async ([userId, permission]): Promise<[UserEntity, ProblemPermissionLevel]> => [
            await this.userService.findUserById(userId),
            permission
          ]
        )
      ),
      await Promise.all(
        groupPermissionList.map(
          async ([groupId, permission]): Promise<[GroupEntity, ProblemPermissionLevel]> => [
            await this.groupService.findGroupById(groupId),
            permission
          ]
        )
      )
    ];
  }

  async setProblemDisplayId(problem: ProblemEntity, displayId: number): Promise<boolean> {
    if (!displayId) displayId = null;
    if (problem.displayId === displayId) return true;

    try {
      problem.displayId = displayId;
      await this.problemRepository.save(problem);
      return true;
    } catch (e) {
      if (
        await this.problemRepository.count({
          displayId: displayId
        })
      )
        return false;

      throw e;
    }
  }

  async setProblemPublic(problem: ProblemEntity, isPublic: boolean): Promise<void> {
    if (problem.isPublic === isPublic) return;

    problem.isPublic = isPublic;
    await this.problemRepository.save(problem);
  }

  async addProblemFile(
    problem: ProblemEntity,
    sha256: string,
    type: ProblemFileType,
    filename: string
  ): Promise<boolean> {
    return await this.connection.transaction("READ COMMITTED", async transactionalEntityManager => {
      const uuid = await this.fileService.tryReferenceFile(sha256, transactionalEntityManager);
      if (!uuid) {
        return false;
      }

      let problemFile = await this.problemFileRepository.findOne({
        problemId: problem.id,
        type: type,
        filename: filename
      });
      if (problemFile) {
        // Rereference old file
        await this.fileService.dereferenceFile(problemFile.uuid, transactionalEntityManager);
      } else {
        problemFile = new ProblemFileEntity();
        problemFile.problemId = problem.id;
        problemFile.type = type;
        problemFile.filename = filename;
      }

      problemFile.uuid = uuid;
      await transactionalEntityManager.save(ProblemFileEntity, problemFile);

      return true;
    });
  }

  async removeProblemFiles(problem: ProblemEntity, type: ProblemFileType, filenames: string[]): Promise<void> {
    await this.connection.transaction("READ COMMITTED", async transactionalEntityManager => {
      for (const filename of filenames) {
        const problemFile = await transactionalEntityManager.findOne(ProblemFileEntity, {
          problemId: problem.id,
          type: type,
          filename: filename
        });

        if (!problemFile) continue;

        await transactionalEntityManager.remove(ProblemFileEntity, problemFile);
        await this.fileService.dereferenceFile(problemFile.uuid, transactionalEntityManager);
      }
    });
  }

  async listProblemFiles(
    problem: ProblemEntity,
    type: ProblemFileType,
    withSize: boolean = false
  ): Promise<ProblemFileDto[]> {
    const problemFiles: ProblemFileDto[] = await this.problemFileRepository.find({
      problemId: problem.id,
      type: type
    });

    if (withSize) {
      const fileSizes = await this.fileService.getFileSizes(problemFiles.map(problemFile => problemFile.uuid));
      return problemFiles.map((problemFile, i) => ({
        ...problemFile,
        size: fileSizes[i]
      }));
    }

    return problemFiles;
  }

  async renameProblemFile(
    problem: ProblemEntity,
    type: ProblemFileType,
    filename: string,
    newFilename: string
  ): Promise<boolean> {
    const problemFile = await this.problemFileRepository.findOne({
      problemId: problem.id,
      type: type,
      filename: filename
    });

    if (!problemFile) return false;

    // Since filename is a PRIMARY key, use .save() will create another record
    await this.problemFileRepository.update(problemFile, {
      filename: newFilename
    });

    return true;
  }

  async updateProblemStatistics(
    problemId: number,
    incSubmissionCount: number,
    incAcceptedSubmissionCount: number
  ): Promise<void> {
    if (incSubmissionCount !== 0) {
      await this.problemRepository.increment({ id: problemId }, "submissionCount", incSubmissionCount);
    }

    if (incAcceptedSubmissionCount !== 0) {
      await this.problemRepository.increment({ id: problemId }, "acceptedSubmissionCount", incAcceptedSubmissionCount);
    }
  }

  async findProblemTagById(id: number): Promise<ProblemTagEntity> {
    return this.problemTagRepository.findOne(id);
  }

  async findProblemTagsByExistingIds(problemTagIds: number[]): Promise<ProblemTagEntity[]> {
    if (problemTagIds.length === 0) return [];
    const uniqueIds = Array.from(new Set(problemTagIds));
    const records = await this.problemTagRepository.findByIds(uniqueIds);
    const map = Object.fromEntries(records.map(record => [record.id, record]));
    return problemTagIds.map(problemId => map[problemId]);
  }

  async getAllProblemTags(): Promise<ProblemTagEntity[]> {
    return await this.problemTagRepository.find();
  }

  async createProblemTag(localizedNames: [Locale, string][], color: string): Promise<ProblemTagEntity> {
    return await this.connection.transaction("READ COMMITTED", async transactionalEntityManager => {
      const problemTag = new ProblemTagEntity();
      problemTag.color = color;
      problemTag.locales = localizedNames.map(([locale, name]) => locale);
      await transactionalEntityManager.save(problemTag);

      for (const [locale, name] of localizedNames) {
        await this.localizedContentService.createOrUpdate(
          problemTag.id,
          LocalizedContentType.PROBLEM_TAG_NAME,
          locale,
          name,
          transactionalEntityManager
        );
      }

      return problemTag;
    });
  }

  async updateProblemTag(
    problemTag: ProblemTagEntity,
    localizedNames: [Locale, string][],
    color: string
  ): Promise<void> {
    await this.connection.transaction("READ COMMITTED", async transactionalEntityManager => {
      problemTag.color = color;
      problemTag.locales = localizedNames.map(([locale, name]) => locale);
      await transactionalEntityManager.save(problemTag);

      await this.localizedContentService.delete(
        problemTag.id,
        LocalizedContentType.PROBLEM_TAG_NAME,
        null,
        transactionalEntityManager
      );
      for (const [locale, name] of localizedNames) {
        await this.localizedContentService.createOrUpdate(
          problemTag.id,
          LocalizedContentType.PROBLEM_TAG_NAME,
          locale,
          name,
          transactionalEntityManager
        );
      }
    });
  }

  async deleteProblemTag(problemTag: ProblemTagEntity): Promise<void> {
    await this.connection.transaction("READ COMMITTED", async transactionalEntityManager => {
      await transactionalEntityManager.delete(ProblemTagEntity, {
        id: problemTag.id
      });

      await this.localizedContentService.delete(
        problemTag.id,
        LocalizedContentType.PROBLEM_TAG_NAME,
        null,
        transactionalEntityManager
      );
    });
  }

  async getProblemTagLocalizedName(problemTag: ProblemTagEntity, locale: Locale): Promise<string> {
    return await this.localizedContentService.get(problemTag.id, LocalizedContentType.PROBLEM_TAG_NAME, locale);
  }

  /**
   * Get the tag dto with localized name of requested locale, if not available, the name of default locale is used.
   */
  async getProblemTagLocalized(problemTag: ProblemTagEntity, locale: Locale): Promise<LocalizedProblemTagDto> {
    const nameLocale = problemTag.locales.includes(locale) ? locale : problemTag.locales[0];
    const name = await this.getProblemTagLocalizedName(problemTag, nameLocale);
    return {
      id: problemTag.id,
      color: problemTag.color,
      name: name,
      nameLocale: nameLocale
    };
  }

  async getProblemTagAllLocalizedNames(problemTag: ProblemTagEntity): Promise<Partial<Record<Locale, string>>> {
    return await this.localizedContentService.getOfAllLocales(problemTag.id, LocalizedContentType.PROBLEM_TAG_NAME);
  }

  async setProblemTags(
    problem: ProblemEntity,
    problemTags: ProblemTagEntity[],
    transactionalEntityManager: EntityManager
  ): Promise<void> {
    await transactionalEntityManager.delete(ProblemTagMapEntity, {
      problemId: problem.id
    });
    if (problemTags.length === 0) return;
    await transactionalEntityManager
      .createQueryBuilder()
      .insert()
      .into(ProblemTagMapEntity)
      .values(problemTags.map(problemTag => ({ problemId: problem.id, problemTagId: problemTag.id })))
      .execute();
  }

  async getProblemTagsByProblem(problem: ProblemEntity): Promise<ProblemTagEntity[]> {
    const problemTagMaps = await this.problemTagMapRepository.find({
      problemId: problem.id
    });

    return await this.findProblemTagsByExistingIds(problemTagMaps.map(problemTagMap => problemTagMap.problemTagId));
  }
}
