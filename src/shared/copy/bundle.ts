import { accessibilityCopy } from "./domains/accessibilityCopy.ts";
import { aboutCopy } from "./domains/aboutCopy.ts";
import { appCopy } from "./domains/appCopy.ts";
import { backupCopy } from "./domains/backupCopy.ts";
import { categoriesCopy } from "./domains/categoriesCopy.ts";
import { commonCopy } from "./domains/commonCopy.ts";
import { dashboardCopy } from "./domains/dashboardCopy.ts";
import { dataCopy } from "./domains/dataCopy.ts";
import { dateTimeCopy } from "./domains/dateTimeCopy.ts";
import { dialogCopy } from "./domains/dialogCopy.ts";
import { historyCopy } from "./domains/historyCopy.ts";
import { mappingCopy } from "./domains/mappingCopy.ts";
import { servicesCopy } from "./domains/servicesCopy.ts";
import { settingsCopy } from "./domains/settingsCopy.ts";
import { toastCopy } from "./domains/toastCopy.ts";
import { toolsCopy } from "./domains/toolsCopy.ts";
import { updateCopy } from "./domains/updateCopy.ts";
import { exportCopy } from "./domains/exportCopy.ts";
import { widgetCopy } from "./domains/widgetCopy.ts";
import type { UiLanguage, WidenCopyValue } from "./types.ts";

export const ZH_CN_UI_TEXT = {
  ...accessibilityCopy["zh-CN"],
  ...aboutCopy["zh-CN"],
  ...appCopy["zh-CN"],
  ...backupCopy["zh-CN"],
  ...categoriesCopy["zh-CN"],
  ...commonCopy["zh-CN"],
  ...dashboardCopy["zh-CN"],
  ...dataCopy["zh-CN"],
  ...dateTimeCopy["zh-CN"],
  ...dialogCopy["zh-CN"],
  ...historyCopy["zh-CN"],
  ...mappingCopy["zh-CN"],
  ...exportCopy["zh-CN"],
  ...servicesCopy["zh-CN"],
  ...settingsCopy["zh-CN"],
  ...toastCopy["zh-CN"],
  ...toolsCopy["zh-CN"],
  ...updateCopy["zh-CN"],
  ...widgetCopy["zh-CN"],
};

const EN_US_UI_TEXT = {
  ...accessibilityCopy["en-US"],
  ...aboutCopy["en-US"],
  ...appCopy["en-US"],
  ...backupCopy["en-US"],
  ...categoriesCopy["en-US"],
  ...commonCopy["en-US"],
  ...dashboardCopy["en-US"],
  ...dataCopy["en-US"],
  ...dateTimeCopy["en-US"],
  ...dialogCopy["en-US"],
  ...historyCopy["en-US"],
  ...mappingCopy["en-US"],
  ...exportCopy["en-US"],
  ...servicesCopy["en-US"],
  ...settingsCopy["en-US"],
  ...toastCopy["en-US"],
  ...toolsCopy["en-US"],
  ...updateCopy["en-US"],
  ...widgetCopy["en-US"],
} satisfies WidenCopyValue<typeof ZH_CN_UI_TEXT>;

export const COPY = {
  "zh-CN": ZH_CN_UI_TEXT,
  "en-US": EN_US_UI_TEXT,
} satisfies Record<UiLanguage, WidenCopyValue<typeof ZH_CN_UI_TEXT>>;

export const SUPPORTED_UI_LANGUAGES = Object.keys(COPY) as UiLanguage[];
