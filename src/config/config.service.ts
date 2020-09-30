import fs from "fs-extra";

import { validateSync } from "class-validator";
import { plainToClass } from "class-transformer";
import yaml from "js-yaml";

import { AppConfig } from "./config.schema";
import { checkConfigRelation } from "./config-relation.decorator";

export class ConfigService {
  public readonly config: AppConfig;

  constructor() {
    const filePath = process.env.SYZOJ_NG_CONFIG_FILE;
    if (!filePath) {
      throw new Error("Please specify configuration file with environment variable SYZOJ_NG_CONFIG_FILE");
    }

    const config = yaml.safeLoad(fs.readFileSync(filePath).toString());
    this.config = this.validateInput(config);
  }

  private validateInput(inputConfig: unknown): AppConfig {
    const appConfig = plainToClass(AppConfig, inputConfig);
    const errors = validateSync(appConfig, {
      validationError: {
        target: false
      }
    });

    if (errors.length > 0) {
      throw new Error(`Config validation error: ${JSON.stringify(errors, null, 2)}`);
    }

    checkConfigRelation((appConfig as unknown) as Record<string, unknown>);

    return appConfig;
  }
}
