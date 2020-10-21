import { createHash } from "crypto";

import { Controller, Post, Body, Req } from "@nestjs/common";
import { ApiOperation, ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "@/common/user.decorator";
import { UserEntity } from "@/user/user.entity";
import { AuditService } from "@/audit/audit.service";
import { RequestWithSession } from "@/auth/auth.middleware";
import { UserService } from "@/user/user.service";
import { AuthSessionService } from "@/auth/auth-session.service";

import { UserMigrationService } from "./user-migration.service";
import {
  MigrateUserRequestDto,
  MigrateUserResponseDto,
  MigrateUserResponseError,
  QueryUserMigrationInfoRequestDto,
  QueryUserMigrationInfoResponseDto,
  QueryUserMigrationInfoResponseError
} from "./dtos";

@ApiTags("Migration")
@Controller("migration")
export class MigrationController {
  constructor(
    private readonly auditService: AuditService,
    private readonly authSessionService: AuthSessionService,
    private readonly userService: UserService,
    private readonly userMigrationService: UserMigrationService
  ) {}

  @Post("migrateUser")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Migrate a user to new username/email/password."
  })
  async migrateUser(
    @Req() req: RequestWithSession,
    @CurrentUser() currentUser: UserEntity,
    @Body() request: MigrateUserRequestDto
  ): Promise<MigrateUserResponseDto> {
    if (currentUser)
      return {
        error: MigrateUserResponseError.ALREADY_LOGGEDIN
      };

    const userMigrationInfo = await this.userMigrationService.findUserMigrationInfoByOldUsername(request.oldUsername);
    if (!userMigrationInfo)
      return {
        error: MigrateUserResponseError.NO_SUCH_USER
      };

    if (userMigrationInfo.migrated)
      return {
        error: MigrateUserResponseError.ALREADY_MIGRATED
      };

    // The magic salt of SYZOJ 2 -- "syzoj2_xxx"
    const oldPasswordHash = createHash("md5").update(`${request.oldPassword}syzoj2_xxx`).digest("hex");
    if (oldPasswordHash.toLowerCase() !== userMigrationInfo.oldPasswordHash.toLowerCase())
      return {
        error: MigrateUserResponseError.WRONG_PASSWORD
      };

    if (userMigrationInfo.usernameMustChange)
      if (!(await this.userService.checkUsernameAvailability(request.newUsername)))
        return {
          error: MigrateUserResponseError.DUPLICATE_USERNAME
        };

    const user = await this.userMigrationService.migrateUser(
      userMigrationInfo,
      request.newUsername,
      request.newPassword
    );

    await this.auditService.log(
      user.id,
      "migration.migrate",
      userMigrationInfo.usernameMustChange
        ? {
            newUsername: request.newUsername
          }
        : null
    );

    return {
      token: await this.authSessionService.newSession(user, req.ip, req.headers["user-agent"])
    };
  }

  @Post("queryUserMigrationInfo")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Query a user's migration info."
  })
  async queryUserMigrationInfo(
    @CurrentUser() currentUser: UserEntity,
    @Body() request: QueryUserMigrationInfoRequestDto
  ): Promise<QueryUserMigrationInfoResponseDto> {
    if (currentUser)
      return {
        error: QueryUserMigrationInfoResponseError.ALREADY_LOGGEDIN
      };

    const userMigrationInfo = await this.userMigrationService.findUserMigrationInfoByOldUsername(request.oldUsername);
    if (!userMigrationInfo)
      return {
        error: QueryUserMigrationInfoResponseError.NO_SUCH_USER
      };

    if (userMigrationInfo.migrated)
      return {
        migrated: true
      };

    return {
      migrated: false,
      usernameMustChange: userMigrationInfo.usernameMustChange
    };
  }
}
