import { Injectable } from "@angular/core";
import { BehaviorSubject, type Observable } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import englishMessages from "../../../../../vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json";

type OfficialMessage = {
  readonly message: string;
  readonly description?: string;
  readonly placeholders?: Readonly<
    Record<string, { readonly content: string; readonly example?: string }>
  >;
};

export const officialFormZhCnMessages = {
  add: { message: "添加" },
  addField: { message: "添加字段" },
  addWebsite: { message: "添加网站" },
  addedItem: { message: "项目已添加" },
  additionalOptions: { message: "附加选项" },
  authenticatorKey: { message: "验证器密钥" },
  authenticatorAppTitle: { message: "验证器 App" },
  autofillOptions: { message: "自动填充选项" },
  baseDomain: {
    message: "基础域名",
    description: "Domain name. Ex. website.com",
  },
  cancel: { message: "取消" },
  cfTypeCheckbox: { message: "复选框型" },
  cfTypeHidden: { message: "隐藏型" },
  cfTypeText: { message: "文本型" },
  checkBoxHelpText: {
    message:
      "如果您想自动勾选表单复选框（例如记住电子邮箱），请使用复选框型字段",
  },
  continue: { message: "继续" },
  customFields: { message: "自定义字段" },
  default: { message: "默认" },
  defaultLabelWithValue: {
    message: "默认（$VALUE$）",
    description:
      "A label that indicates the default value for a field with the current default value in parentheses.",
    placeholders: { value: { content: "$1", example: "Base domain" } },
  },
  deleteCustomField: {
    message: "删除 $LABEL$",
    placeholders: { label: { content: "$1", example: "Custom field" } },
  },
  deleteWebsite: { message: "删除网站" },
  editField: { message: "编辑字段" },
  editFieldLabel: {
    message: "编辑 $LABEL$",
    placeholders: { label: { content: "$1", example: "Custom field" } },
  },
  editedItem: { message: "项目已保存" },
  exact: { message: "精确" },
  favorite: { message: "收藏" },
  fieldAdded: {
    message: "$LABEL$ 已添加",
    placeholders: { label: { content: "$1", example: "Custom field" } },
  },
  fieldLabel: { message: "字段标签" },
  fieldType: { message: "字段类型" },
  folder: { message: "文件夹" },
  generatePassword: { message: "生成密码" },
  generateUsername: { message: "生成用户名" },
  hiddenHelpText: { message: "对于如密码之类的敏感数据，请使用隐藏型字段" },
  hideMatchDetectionNoPlaceholder: { message: "隐藏匹配检测" },
  host: {
    message: "主机",
    description:
      "A URL's host value. For example, the host of https://sub.domain.com:443 is 'sub.domain.com:443'.",
  },
  inputRequired: { message: "必须输入内容。" },
  itemDetails: { message: "项目详细信息" },
  itemName: { message: "项目名称" },
  learnMoreAboutAuthenticators: { message: "进一步了解验证器" },
  loginCredentials: { message: "登录凭据" },
  matchDetection: {
    message: "匹配检测",
    description: "URI match detection for autofill.",
  },
  multipleFieldsNeedAttention: {
    message: "有 $COUNT$ 个字段需要您注意。",
    placeholders: { count: { content: "$1", example: "2" } },
  },
  never: { message: "从不" },
  notes: { message: "备注" },
  password: { message: "密码" },
  passwordPrompt: { message: "主密码二次验证" },
  regEx: {
    message: "正则表达式",
    description: "A programming term, also known as 'RegEx'.",
  },
  regExAdvancedOptionWarning: {
    message: "「正则表达方式」是一种高级选项，会增加暴露凭据的风险。",
    description:
      "Content for dialog which warns a user when selecting 'regular expression' matching strategy as a cipher match strategy",
  },
  reorderFieldDown: {
    message: "$LABEL$ 已下移，位置 $INDEX$ / $LENGTH$",
    placeholders: {
      label: { content: "$1", example: "Custom field" },
      index: { content: "$2", example: "1" },
      length: { content: "$3", example: "3" },
    },
  },
  reorderFieldUp: {
    message: "$LABEL$ 已上移，位置 $INDEX$ / $LENGTH$",
    placeholders: {
      label: { content: "$1", example: "Custom field" },
      index: { content: "$2", example: "1" },
      length: { content: "$3", example: "3" },
    },
  },
  reorderToggleButton: {
    message: "重新排序 $LABEL$。使用方向键向上或向下移动项目。",
    placeholders: { label: { content: "$1", example: "Custom field" } },
  },
  save: { message: "保存" },
  securePasswordGenerated: {
    message: "安全的密码已生成！不要忘记在网站上更新您的密码。",
  },
  showMatchDetectionNoPlaceholder: { message: "显示匹配检测" },
  singleFieldNeedsAttention: { message: "有 1 个字段需要您注意。" },
  startsWith: { message: "开始于" },
  startsWithAdvancedOptionWarning: {
    message: "「开始于」是一种高级选项，会增加暴露凭据的风险。",
    description:
      "Content for dialog which warns a user when selecting 'starts with' matching strategy as a cipher match strategy",
  },
  textHelpText: { message: "对于如安全问题之类的数据，请使用文本型字段" },
  totpHelper: {
    message: "Bitwarden 可以存储并填充两步验证码。复制并粘贴密钥到此字段中。",
  },
  totpHelperTitle: { message: "无缝两步验证" },
  uriAdvancedOption: {
    message: "高级选项",
    description: "Advanced option placeholder for uri option component",
  },
  uriMatchDefaultStrategyHint: {
    message: "Bitwarden 根据 URI 匹配检测来识别自动填充建议。",
    description:
      "Explains to the user that URI match detection determines how Bitwarden suggests autofill options, and clarifies that this default strategy applies when no specific match detection is set for a login item.",
  },
  useGeneratorHelpTextPartOne: {
    message: "使用生成器",
    description:
      "This will be used as part of a larger sentence, broken up to include the generator icon. The full sentence will read 'Use the generator [GENERATOR_ICON] to create a strong unique password'",
  },
  useGeneratorHelpTextPartTwo: {
    message: "创建强大且唯一的密码",
    description:
      "This will be used as part of a larger sentence, broken up to include the generator icon. The full sentence will read 'Use the generator [GENERATOR_ICON] to create a strong unique password'",
  },
  username: { message: "用户名" },
  warningCapitalized: {
    message: "警告",
    description: "Warning (should maintain locale-relevant capitalization)",
  },
  websiteAdded: { message: "网址已添加" },
  websiteUri: { message: "网站 (URI)" },
  websiteUriCount: {
    message: "网站 (URI) $COUNT$",
    description:
      "Label for an input field that contains a website URI. The input field is part of a list of fields, and the count indicates the position of the field in the list.",
    placeholders: { count: { content: "$1", example: "3" } },
  },
} as const satisfies Readonly<Record<string, OfficialMessage>>;

export const officialPersonalFormZhCnMessages = {
  "add": {
    "message": "添加"
  },
  "addField": {
    "message": "添加字段"
  },
  "additionalOptions": {
    "message": "附加选项"
  },
  "address": {
    "message": "地址"
  },
  "address1": {
    "message": "地址 1"
  },
  "address2": {
    "message": "地址 2"
  },
  "address3": {
    "message": "地址 3"
  },
  "april": {
    "message": "四月"
  },
  "august": {
    "message": "八月"
  },
  "brand": {
    "message": "品牌"
  },
  "cancel": {
    "message": "取消"
  },
  "cardBrandDetails": {
    "message": "$BRAND$ 详细信息",
    "placeholders": {
      "brand": {
        "content": "$1",
        "example": "Visa"
      }
    }
  },
  "cardDetails": {
    "message": "支付卡详细信息"
  },
  "cardholderName": {
    "message": "持卡人姓名"
  },
  "cfTypeCheckbox": {
    "message": "复选框型"
  },
  "cfTypeHidden": {
    "message": "隐藏型"
  },
  "cfTypeLinked": {
    "message": "链接型",
    "description": "This describes a field that is 'linked' (tied) to another field."
  },
  "cfTypeText": {
    "message": "文本型"
  },
  "checkBoxHelpText": {
    "message": "如果您想自动勾选表单复选框（例如记住电子邮箱），请使用复选框型字段"
  },
  "cityTown": {
    "message": "市 / 镇"
  },
  "company": {
    "message": "公司"
  },
  "contactInfo": {
    "message": "联系信息"
  },
  "country": {
    "message": "国家 / 地区"
  },
  "customFields": {
    "message": "自定义字段"
  },
  "december": {
    "message": "十二月"
  },
  "deleteCustomField": {
    "message": "删除 $LABEL$",
    "placeholders": {
      "label": {
        "content": "$1",
        "example": "Custom field"
      }
    }
  },
  "dr": {
    "message": "博士"
  },
  "editField": {
    "message": "编辑字段"
  },
  "editFieldLabel": {
    "message": "编辑 $LABEL$",
    "placeholders": {
      "label": {
        "content": "$1",
        "example": "Custom field"
      }
    }
  },
  "email": {
    "message": "电子邮箱"
  },
  "expirationMonth": {
    "message": "过期月份"
  },
  "expirationYear": {
    "message": "过期年份"
  },
  "favorite": {
    "message": "收藏"
  },
  "february": {
    "message": "二月"
  },
  "fieldAdded": {
    "message": "$LABEL$ 已添加",
    "placeholders": {
      "label": {
        "content": "$1",
        "example": "Custom field"
      }
    }
  },
  "fieldLabel": {
    "message": "字段标签"
  },
  "fieldType": {
    "message": "字段类型"
  },
  "firstName": {
    "message": "名字"
  },
  "folder": {
    "message": "文件夹"
  },
  "fullName": {
    "message": "全名"
  },
  "hiddenHelpText": {
    "message": "对于如密码之类的敏感数据，请使用隐藏型字段"
  },
  "identification": {
    "message": "身份"
  },
  "itemDetails": {
    "message": "项目详细信息"
  },
  "itemName": {
    "message": "项目名称"
  },
  "january": {
    "message": "一月"
  },
  "july": {
    "message": "七月"
  },
  "june": {
    "message": "六月"
  },
  "lastName": {
    "message": "姓氏"
  },
  "licenseNumber": {
    "message": "驾驶证号码"
  },
  "linkedHelpText": {
    "message": "当您遇到特定网站的自动填充问题时，请使用链接型字段。"
  },
  "march": {
    "message": "三月"
  },
  "may": {
    "message": "五月"
  },
  "middleName": {
    "message": "中间名"
  },
  "mr": {
    "message": "先生"
  },
  "mrs": {
    "message": "夫人"
  },
  "ms": {
    "message": "女士"
  },
  "multipleFieldsNeedAttention": {
    "message": "有 $COUNT$ 个字段需要您注意。",
    "placeholders": {
      "count": {
        "content": "$1",
        "example": "2"
      }
    }
  },
  "mx": {
    "message": "Mx"
  },
  "notes": {
    "message": "备注"
  },
  "november": {
    "message": "十一月"
  },
  "number": {
    "message": "号码"
  },
  "october": {
    "message": "十月"
  },
  "other": {
    "message": "其他"
  },
  "passportNumber": {
    "message": "护照号码"
  },
  "passwordPrompt": {
    "message": "主密码二次验证"
  },
  "personalDetails": {
    "message": "个人详细信息"
  },
  "phone": {
    "message": "电话"
  },
  "reorderFieldDown": {
    "message": "$LABEL$ 已下移，位置 $INDEX$ / $LENGTH$",
    "placeholders": {
      "label": {
        "content": "$1",
        "example": "Custom field"
      },
      "index": {
        "content": "$2",
        "example": "1"
      },
      "length": {
        "content": "$3",
        "example": "3"
      }
    }
  },
  "reorderFieldUp": {
    "message": "$LABEL$ 已上移，位置 $INDEX$ / $LENGTH$",
    "placeholders": {
      "label": {
        "content": "$1",
        "example": "Custom field"
      },
      "index": {
        "content": "$2",
        "example": "1"
      },
      "length": {
        "content": "$3",
        "example": "3"
      }
    }
  },
  "reorderToggleButton": {
    "message": "重新排序 $LABEL$。使用方向键向上或向下移动项目。",
    "placeholders": {
      "label": {
        "content": "$1",
        "example": "Custom field"
      }
    }
  },
  "save": {
    "message": "保存"
  },
  "securityCode": {
    "message": "安全码"
  },
  "select": {
    "message": "选择"
  },
  "september": {
    "message": "九月"
  },
  "singleFieldNeedsAttention": {
    "message": "有 1 个字段需要您注意。"
  },
  "ssn": {
    "message": "社会保障号码"
  },
  "stateProvince": {
    "message": "州 / 省"
  },
  "textHelpText": {
    "message": "对于如安全问题之类的数据，请使用文本型字段"
  },
  "title": {
    "message": "称呼"
  },
  "username": {
    "message": "用户名"
  },
  "zipPostalCodeLabel": {
    "message": "ZIP / 邮政编码"
  }
} as const satisfies Readonly<Record<string, OfficialMessage>>;

export const officialTrashWarningZhCn =
  "回收站中超过 30 天的项目将被自动删除。";

const translations: Readonly<Record<string, string>> = {
  addWebsiteOrApp: "添加网站或应用",
  app: "应用",
  appUri: "应用（URI）",
  appUriCount: "应用（URI）{0}",
  copied: "已复制",
  about: "关于",
  aboutBitwarden: "关于 Bitwarden",
  accountSecurity: "账户安全",
  address1: "地址 1",
  address2: "地址 2",
  address3: "地址 3",
  appearance: "外观",
  archiveNoun: "归档",
  autoFillOnPageLoad: "页面加载时自动填充吗？",
  bitWebVaultApp: "Bitwarden 网页 App",
  brand: "品牌",
  cannotRemoveViewOnlyCollections: "您无法移除仅具有「查看」权限的集合：{0}",
  cannotSaveItemNoConfirmedOrgs: "无法保存项目。您必须先通过组织确认才能保存项目。",
  changeMasterPassword: "更改主密码",
  clone: "克隆",
  clearFiltersOrTryAnother: "清除筛选或尝试其他搜索词",
  collection: "集合",
  collections: "集合",
  compactMode: "紧凑模式",
  copy: "复制",
  copyLink: "复制链接",
  copySuccessful: "复制成功",
  country: "国家 / 地区",
  createdSend: "Send 已创建",
  createdSendSuccessfully: "Send 创建成功！",
  delete: "删除",
  deletionDate: "删除日期",
  edit: "编辑",
  errorOccurred: "发生错误",
  expired: "已过期",
  fingerprintPhrase: "指纹短语",
  firstName: "名字",
  forwardedEmail: "转发的电子邮箱别名",
  helpCenter: "帮助中心",
  lastName: "姓氏",
  lastSeenOn: "最后上线于：{0}",
  linkedLabelHelpText: "输入字段的 html id、名称、aria-label 或占位符。",
  light: "浅色",
  dark: "深色",
  invalidVerificationCode: "无效的验证码",
  masterPassSent: "我们已经向您发送了一封包含主密码提示的电子邮件。",
  maxAccessCountReached: "已达最大访问次数",
  middleName: "中间名",
  noItemsMatchSearch: "没有搜索到匹配的项目",
  otherOptions: "其他选项",
  owner: "所有者",
  sendDisabled: "Send 已禁用",
  sendDisabledWarning: "由于某个企业策略，您只能删除现有的 Send。",
  sendNotCompliantWithYourOrgsPolicy: "不符合您组织的 Send 策略",
  sendsBodyNoItems: "在任何平台上与任何人安全地分享文件和数据。您的信息将在限制曝光的同时保持端到端加密。",
  sendsTitleNoItems: "安全地发送敏感信息",
  serverVersion: "服务器版本",
  service: "服务",
  sessionTimeoutHeader: "会话超时",
  settingsVaultOptions: "密码库选项",
  showAnimations: "显示动画",
  showIconsChangePasswordUrls: "显示网站图标并获取更改密码的 URL",
  showQuickCopyActions: "在密码库上显示快速复制操作",
  syncingComplete: "同步完成",
  syncingFailed: "同步失败",
  systemDefault: "跟随系统",
  theme: "主题",
  thirdParty: "第三方",
  thirdPartyServerMessage: "已连接到第三方服务器实现，{0}。请使用官方服务器验证错误，或将其报告给第三方服务器。",
  title: "称呼",
  troubleshooting: "故障排除",
  typePasskey: "通行密钥",
  uriMatchWarningDialogLink: "更多关于匹配检测",
  vaultCustomization: "密码库自定义",
  version: "版本",
  accountActions: "账户操作",
  accountLimitReached: "已达到账户数量上限",
  active: "已激活",
  activeAccount: "当前账户",
  addAccount: "添加账户",
  availableAccounts: "可用账户",
  bitwardenAccount: "Bitwarden 账户",
  hostedAt: "托管于",
  locked: "已锁定",
  lockAll: "锁定全部",
  lockNow: "立即锁定",
  logOut: "注销",
  logOutConfirmation: "确认要注销吗？",
  no: "否",
  switchAccounts: "切换账户",
  switchToAccount: "切换到账户",
  unlocked: "已解锁",
  unlockMethodNeeded: "需要配置解锁方式",
  yes: "是",
  accountEmail: "\u8d26\u6237\u7535\u5b50\u90ae\u7bb1",
  continue: "\u7ee7\u7eed",
  emailAddress: "\u7535\u5b50\u90ae\u7bb1\u5730\u5740",
  verificationCode: "验证码",
  verifyYourIdentity: "验证您的身份",
  resendCode: "重新发送代码",
  dontAskAgainOnThisDeviceFor30Days: "30 天内不再询问此设备",
  continueLoggingIn: "继续登录",
  or: "或",
  selectAnotherMethod: "选择其他方式",
  selectTwoStepLoginMethod: "选择两步登录方式",
  noTwoStepProviders: "此账户已设置两步登录，但此浏览器不支持任何已配置的两步登录提供程序。",
  hint: "\u5bc6\u7801\u63d0\u793a",
  logIn: "\u767b\u5f55",
  masterPass: "\u4e3b\u5bc6\u7801",
  rememberEmail: "\u8bb0\u4f4f\u7535\u5b50\u90ae\u7bb1",
  requestHint: "\u8bf7\u6c42\u5bc6\u7801\u63d0\u793a",
  accessing: "正在访问",
  appLogoLabel: "Bitwarden",
  back: "返回",
  baseUrl: "服务器 URL",
  callout: "提示",
  close: "关闭",
  error: "错误",
  fieldsNeedAttention: "以下字段需要注意：{0}",
  filterApplied: "已应用一个筛选",
  filterAppliedPlural: "已应用 {0} 个筛选",
  filters: "筛选",
  filterVault: "筛选密码库",
  folder: "文件夹",
  additionalOptions: "附加选项",
  autofillOptions: "自动填充选项",
  address: "地址",
  cardBrandDetails: "{0} 详细信息",
  cardDetails: "支付卡信息",
  cardExpiredTitle: "过期的支付卡",
  cardExpiredMessage: "如果您的支付卡已续期，请更新该卡的信息",
  cardholderName: "持卡人姓名",
  cityTown: "城市/城镇",
  company: "公司",
  contactInfo: "联系信息",
  copyAddress: "复制地址",
  copyCardholderName: "复制持卡人姓名",
  copyCompany: "复制公司",
  copyCustomField: "复制 {0}",
  copyEmail: "复制电子邮箱",
  copyLicenseNumber: "复制驾照号码",
  copyName: "复制姓名",
  copyNotes: "复制备注",
  copyNumber: "复制卡号",
  copyPassportNumber: "复制护照号码",
  copyPhone: "复制电话",
  copySecurityCode: "复制安全码",
  copySSN: "复制社会安全号码",
  copyUsername: "复制用户名",
  copyVerificationCode: "复制验证码",
  copyWebsite: "复制网站",
  cfTypeLinked: "链接型",
  customFields: "自定义字段",
  dateCreated: "创建于",
  datePasswordUpdated: "密码更新于",
  email: "电子邮箱",
  expiration: "到期时间",
  expirationMonth: "到期月份",
  expirationYear: "到期年份",
  hideCharacterCount: "隐藏字符计数",
  identification: "身份证明",
  itemHistory: "项目历史记录",
  lastEdited: "最后编辑于",
  launch: "前往",
  licenseNumber: "驾照号码",
  loginCredentials: "登录凭据",
  name: "姓名",
  noValueEntered: "未输入任何值",
  noneFolder: "无文件夹",
  note: "备注",
  number: "卡号",
  password: "密码",
  passwordHistory: "密码历史记录",
  passportNumber: "护照号码",
  personalDetails: "个人详细信息",
  phone: "电话",
  securityCode: "安全码",
  showCharacterCount: "显示字符计数",
  ssn: "社会安全号码",
  stateProvince: "省/州",
  username: "用户名",
  verificationCodeTotp: "验证码 (TOTP)",
  website: "网站",
  zipPostalCodeLabel: "邮政编码",
  generator: "生成器",
  generatorHistory: "生成器历史记录",
  clearGeneratorHistoryTitle: "清除生成器历史记录",
  cleargGeneratorHistoryDescription: "若继续，所有条目将从生成器历史记录中永久删除。确定要继续吗？",
  clearHistory: "清除历史记录",
  nothingToShow: "没有可显示的内容",
  nothingGeneratedRecently: "您最近没有生成任何内容",
  options: "选项",
  length: "长度",
  include: "包括",
  uppercaseLabel: "A-Z",
  uppercaseDescription: "大写字母",
  lowercaseLabel: "a-z",
  lowercaseDescription: "小写字母",
  numbersLabel: "0-9",
  numbersDescription: "数字",
  specialCharactersDescription: "特殊字符",
  minNumbers: "最少数字",
  minSpecial: "最少特殊字符",
  avoidAmbiguous: "避免易混淆字符",
  numWords: "单词数量",
  wordSeparator: "单词分隔符",
  capitalize: "首字母大写",
  includeNumber: "包含数字",
  randomWord: "随机单词",
  usernameGenerated: "已生成用户名",
  useThisUsername: "使用此用户名",
  plusAddressedEmail: "加号地址电子邮箱",
  plusAddressedEmailDesc: "在电子邮箱地址中添加随机子地址",
  catchallEmail: "全域电子邮箱",
  catchallEmailDesc: "在指定域名下生成随机电子邮箱地址",
  generateEmail: "生成电子邮箱",
  emailGenerated: "已生成电子邮箱",
  useThisEmail: "使用此电子邮箱",
  domainName: "域名",
  generatorPolicyInEffect: "组织策略已应用。",
  spinboxBoundariesHint: "允许范围：{0} 到 {1}。",
  passwordLengthRecommendationHint: "建议至少使用 {0} 个字符。",
  passphraseNumWordsRecommendationHint: "建议至少使用 {0} 个单词。",
  passphrase: "密码短语",
  generatePassphrase: "生成密码短语",
  passphraseGenerated: "已生成密码短语",
  copyPassphrase: "复制密码短语",
  useThisPassphrase: "使用此密码短语",
  passwordGenerated: "已生成密码",
  copyPassword: "复制密码",
  useThisPassword: "使用此密码",
  inputEmail: "请输入有效的电子邮件地址。",
  inputForbiddenCharacters: "包含不允许的字符：{0}",
  inputMaxLength: "最多可输入 {0} 个字符。",
  inputMaxValue: "最大值为 {0}。",
  inputMinLength: "至少需要 {0} 个字符。",
  inputMinValue: "最小值为 {0}。",
  inputRequired: "此字段为必填项。",
  inputTrimValidator: "开头或结尾不能包含空格。",
  i18nEnglish: "English",
  i18nFollowSystem: "跟随系统",
  i18nLanguage: "语言",
  i18nPrimaryNavigation: "主要导航",
  i18nSimplifiedChinese: "简体中文",
  i18nBitwardenService: "Bitwarden 服务",
  i18nBarwardenProductLabel: "Barwarden，Bitwarden 服务客户端",
  i18nAccountInfoRetained: "账户信息仍保留，请重新解锁。",
  i18nAbout: "关于",
  i18nAddTextSend: "新增文本 Send",
  i18nAllSends: "所有 Send",
  i18nAnyoneWithLink: "任何拥有链接的人",
  i18nAnyoneWithPassword: "任何拥有密码的人",
  i18nCopySendLink: "复制链接",
  i18nCopySendLinkFailed: "无法复制 Send 链接，请重试。",
  i18nCopySendPasswordFailed: "无法复制 Send 密码，请重试。",
  i18nCopiedSendPassword: "已复制 Send 密码",
  i18nCreateSend: "创建 Send",
  i18nDays: "{0} 天",
  i18nDefaultHideText: "默认隐藏文本",
  i18nDeleteDate: "删除日期",
  i18nDeleteDateValue: "删除日期：{0}",
  i18nCopySendLinkFor: "复制链接 - {0}",
  i18nDeleteSendFor: "删除 - {0}",
  i18nDeleteSendFailed: "无法删除 Send，请重试。",
  i18nDeleteSendTitle: "永久删除 Send“{0}”？",
  i18nDeletingSend: "正在删除…",
  i18nDiscardSendContent: "您对该 Send 的更改将不会保存。",
  i18nDiscardSendTitle: "放弃未保存的更改？",
  i18nEditTextSend: "编辑文本 Send",
  i18nExpired: "已过期",
  i18nFilterSend: "筛选 Send",
  i18nGeneratingPasswordFailed: "无法生成密码。请重试。",
  i18nHideEmailFromRecipients: "对接收者隐藏我的电子邮箱地址。",
  i18nLoadingSends: "正在加载 Send",
  i18nLoadingVault: "正在加载密码库",
  i18nMaxAccessCount: "最大访问次数",
  i18nMaxAccessCountHint: "达到限额后，任何人无法查看此 Send。",
  i18nMaxAccessReached: "已达到最大访问次数",
  i18nNewPassword: "新密码",
  i18nNoMatchingSends: "没有匹配的 Send",
  i18nOrganizationPolicyDisabledSend: "组织策略已关闭 Bitwarden Send。",
  i18nOrganizationPolicyDisabledSendStatus: "组织策略已禁用 Send。",
  i18nPasswordProtected: "密码保护",
  i18nPasswordRequiredForSend: "必须输入密码才能访问此 Send。",
  i18nPermanentDeleteSend: "永久删除 Send？",
  i18nPermanentDeleteSendContent: "“{0}”将被永久删除。此操作无法撤销。",
  i18nPrivateNotes: "私密备注",
  i18nRemove: "移除",
  i18nRemoveSendPassword: "移除 Send 密码？",
  i18nRemoveSendPasswordContent: "移除后，任何持有链接的人都可以访问此 Send。",
  i18nRemoveSendPasswordFailed: "无法移除 Send 密码，请重试。",
  i18nSearchSend: "搜索 Send",
  i18nSendCreated: "已创建 Send",
  i18nSendCreatedSuccess: "Send 创建成功",
  i18nSendDeletionHint: "Send 将在设定时间后删除。",
  i18nSendDetails: "Send 详细信息",
  i18nSendDisabled: "Send 已禁用",
  i18nSendEmptyDescription: "在任何平台上安全地分享端到端加密的信息。",
  i18nSendEmptyTitle: "安全地发送敏感信息",
  i18nSendExpires: "创建的 Send 将在 {0}后过期。",
  i18nSendNotFound: "找不到此 Send",
  i18nSendName: "Send 名称",
  i18nSendLinkCopied: "已复制 Send 链接",
  i18nSendDeleted: "Send 已删除",
  i18nSendPasswordExpires: "创建的密码保护 Send 将在 {0}后过期。",
  i18nSendPolicyViolation: "Send 不符合组织策略",
  i18nTextSend: "文本 Send",
  i18nTextToShare: "要分享的文本",
  i18nUnlockBeforeCreatingSend: "请先解锁密码库，再创建 Send。",
  i18nUnableToSaveSend: "无法保存 Send，请重试。",
  i18nViewTextSend: "查看文本 Send",
  i18nWhoCanAccess: "谁可以访问",
  i18nContinueEditing: "继续编辑",
  i18nGeneral: "通用",
  i18nLaunchAtLogin: "登录时启动",
  i18nLaunchAtLoginHint: "在菜单栏中保持可用",
  i18nAccountSecurity: "账户安全",
  i18nAccountChangedReverify: "账户状态已更改，请重新验证主密码。",
  i18nChangeMasterPassword: "更改主密码",
  i18nContinueInWebVault: "在 Web Vault 中继续",
  i18nImmediately: "立即",
  i18nLockAction: "锁定",
  i18nLogOutAction: "注销",
  i18nNever: "永不",
  i18nMinutes: "{0} 分钟",
  i18nOtherOptions: "其他选项",
  i18nPinDeviceHint: "PIN 会加密保存在此设备；重新启动应用后，需先用主密码解锁一次。",
  i18nSessionTimeout: "会话超时",
  i18nSyncing: "同步中",
  i18nNeverSynced: "尚未同步",
  i18nTouchIdCheckSettings: "Touch ID 当前不可用，请检查系统设置。",
  i18nTouchIdCleanupFailed: "Touch ID 已启用，但无法清理。请返回原账户后关闭 Touch ID。",
  i18nTouchIdLocked: "Touch ID 已锁定，请先在系统设置中恢复。",
  i18nTouchIdNotAvailableMac: "此 Mac 当前无法使用 Touch ID。",
  i18nTouchIdNotEnrolled: "请先在系统设置中录入 Touch ID。",
  i18nUnableToDisableTouchId: "无法关闭 Touch ID。请重试。",
  i18nUnableToEnableTouchId: "无法启用 Touch ID。请重试。",
  i18nUnableToOpenLink: "无法打开链接。请重试。",
  i18nUnableToOpenWebVault: "无法打开 Web Vault",
  i18nUnableToReadUnlockOptions: "无法读取解锁选项。请重试。",
  i18nUnableToSetPin: "无法设置 PIN。请重试。",
  i18nUnableToUpdateUnlockMethod: "无法更新解锁方式",
  i18nUnableToUpdateLaunchAtLoginTitle: "无法更新开机启动设置",
  i18nUnableToUpdateLaunchAtLogin: "无法更改登录项，请稍后重试。",
  i18nUnlockOptions: "解锁选项",
  i18nUsePinToUnlock: "使用 PIN 码解锁",
  i18nVaultTimeout: "密码库超时",
  i18nVaultTimeoutAction: "密码库超时动作",
  i18nAllItems: "所有项目",
  favorites: "收藏夹",
  items: "项目",
  searchVault: "搜索密码库",
  searchResults: "搜索结果",
  i18nAddItemType: "新增{0}",
  i18nCloneItemType: "克隆{0}",
  i18nEditItemType: "编辑{0}",
  i18nArchived: "已归档",
  i18nArchiveItemQuestion: "要归档 {0} 吗？",
  i18nArchiveItems: "归档中的项目",
  i18nArchiveOptions: "归档选项 {0}",
  i18nArchivedItemsHint: "归档的项目会显示在这里。",
  i18nNoArchivedItems: "归档中没有项目",
  i18nDeletedItemsHint: "删除的项目会显示在这里。",
  i18nDateUnavailable: "日期不可用",
  i18nAddFavorite: "收藏",
  i18nRemoveFavorite: "取消收藏",
  i18nEditFolder: "编辑文件夹",
  i18nEditFolderLabel: "编辑文件夹 {0}",
  i18nFolderHelp: "文件夹可以帮助你整理密码库项目。",
  i18nFolderValue: "文件夹：{0}",
  i18nFolderName: "文件夹名称",
  i18nNoFolders: "没有文件夹",
  i18nNoPasswords: "列表中没有密码",
  i18nMore: "更多",
  i18nTrashAutoDeleteMessage: officialTrashWarningZhCn,
  i18nTrashAutoDeleteTitle: "项目会自动删除",
  i18nTrashItems: "回收站中的项目",
  i18nTrashOptions: "回收站选项 {0}",
  i18nNoTrashItems: "回收站中没有项目",
  i18nViewItem: "查看项目 {0}",
  i18nView: "查看",
  i18nClone: "克隆",
  i18nSaving: "保存中...",
  i18nUnableToCreateFolder: "无法创建文件夹",
  i18nUnableToUpdateFolder: "无法更新文件夹",
  i18nDeleteFolder: "删除文件夹",
  i18nChooseItemToAdd: "选择要添加的项目",
  i18nCannotUndo: "此操作无法撤销。",
  i18nConfirmArchive: "确认归档",
  i18nConfirmDelete: "确认删除",
  i18nConfirm: "确定",
  i18nConfirmMasterPassword: "确认主密码",
  i18nConfirmPermanentDelete: "确认永久删除",
  i18nDeleteItemQuestion: "要删除 {0} 吗？",
  i18nDeleteItemTitle: "删除项目？",
  i18nArchiveDeleteContent: "此项目将移动到回收站，你可以稍后恢复它。",
  i18nDeleting: "删除中...",
  i18nDeleteFolderContent: "删除此文件夹后，其中的项目仍会保留在密码库中。此操作无法撤销。",
  i18nDeleteFolderFailed: "无法删除文件夹，请重试。",
  i18nDiscard: "放弃",
  i18nDiscardChangesContent: "您有未保存的更改。确定要放弃吗？",
  i18nDiscardChangesTitle: "放弃更改？",
  i18nDelete: "删除",
  i18nEdit: "编辑",
  i18nEmptyVaultDescription: "密码库不仅保护您的密码。在这里还可以安全地存储登录、ID、支付卡和笔记。",
  i18nEmptyVaultTitle: "您的密码库是空的",
  i18nEnterMasterPassword: "请输入主密码。",
  i18nIncorrectMasterPassword: "主密码不正确。",
  i18nNoFoldersYet: "还没有文件夹",
  i18nNoItemsInCategory: "此分类中没有项目",
  i18nNoItemsInNode: "此节点中没有项目",
  i18nVaultCategories: "密码库分类",
  i18nFolderDescription: "创建文件夹以整理密码库项目。",
  i18nHiddenItems: "隐藏的项目",
  i18nIdentityDescription: "保存姓名、邮箱、电话和地址",
  i18nItem: "项目",
  i18nItemNotFound: "未找到项目。",
  i18nItemSavedOpenFailed: "项目已保存，但无法打开。",
  i18nLoginDescription: "保存用户名、密码、TOTP 和网站 URI",
  i18nNewFolder: "新增文件夹",
  i18nNewLogin: "新增登录",
  i18nNoFolder: "无文件夹",
  i18nNoSearchMatches: "没有搜索到匹配的项目",
  i18nNoSearchMatchesHint: "清除筛选或尝试其他搜索词",
  i18nPermanentDeleteItemQuestion: "要永久删除 {0} 吗？",
  i18nPermanentDeleteItemTitle: "永久删除项目？",
  i18nPermanentDeleteItemContent: "此操作无法撤销。该项目将从密码库中永久删除。",
  i18nPermanentDelete: "永久删除",
  i18nPermanentDeleteFolder: "永久删除文件夹？",
  i18nPopOut: "弹出到新窗口",
  i18nRestore: "恢复",
  i18nSaveCardDescription: "保存卡号、到期日和安全码",
  i18nSaveIdentityDescription: "保存姓名、邮箱、电话和地址",
  i18nSaveItemFailed: "无法保存项目，请重试。",
  i18nSaveFolderFailed: "无法保存文件夹，请重试。",
  i18nSaveSecureNoteDescription: "保存只需要加密文本的备注",
  i18nSecureNote: "安全笔记",
  i18nSshKey: "SSH 密钥",
  i18nSyncBeforeEdit: "同步完成后才能编辑该项目。",
  i18nSyncFailedShowingSavedVault: "无法同步，正在显示已保存的密码库数据。",
  i18nVaultLoadFailed: "无法加载密码库，请重试。",
  i18nUnableToVerifyMasterPassword: "无法验证主密码。",
  i18nCopyField: "复制{0}",
  i18nFillField: "填入{0}字段",
  i18nFill: "填充",
  i18nCardNumber: "卡号",
  i18nPassportNumber: "护照号码",
  i18nSsn: "社会安全号码",
  i18nHideField: "隐藏{0}",
  i18nOpenField: "打开{0}",
  i18nShowField: "显示{0}",
  i18nCopyOtpForItem: "复制 {0} 的验证码",
  i18nCopiedOtpForItem: "已复制 {0} 的验证码",
  i18nCopyVerificationCode: "复制验证码",
  i18nFillVerificationCode: "填入验证码字段",
  i18nGeneratingVerificationCode: "正在生成验证码",
  i18nGenerating: "正在生成…",
  i18nGeneratorHistoryFailed: "生成器历史记录操作失败",
  i18nGeneratorHistoryClearFailed: "无法清除生成器历史记录。",
  i18nGeneratorHistoryCopyFailed: "无法复制生成的内容。",
  i18nGeneratorHistoryLoadFailed: "无法加载生成器历史记录。",
  i18nNoMatchingVerificationCodes: "没有搜索到匹配的验证码",
  i18nNoVerificationCodes: "密码库中还没有验证码",
  i18nSearchVerificationCodes: "搜索验证码",
  i18nVerificationCodeExpires: "验证码还有 {0} 秒过期",
  i18nVerificationCodeUnavailable: "验证码暂不可用",
  i18nItemsCount: "项目 ({0})",
  i18nUnableToCompleteOperation: "无法完成操作，请重试。",
  i18nVerifying: "正在验证...",
  i18nVaultRepromptDescription: "此项目要求重新输入主密码后才能查看或使用受保护的信息。",
  i18nUnarchive: "取消归档",
  i18nWebsite: "网站",
  i18nVaultMayBeOutdated: "密码库可能不是最新状态",
  i18nViewItemType: "查看{0}",
  i18nAnimations: "显示动画",
  i18nAboutProduct: "关于 {0}",
  i18nThirdPartyOpenSourceLicenses: "第三方开源许可",
  i18nThirdPartyLicenseSummaryDescription:
    "Barwarden 包含随 macOS 应用发布的第三方开源组件。开发、测试、构建及其他平台依赖未计入。",
  i18nNpmRuntimeComponents: "npm 运行组件",
  i18nCargoRuntimeComponents: "Cargo 运行组件",
  i18nRuntimeComponents: "运行组件",
  i18nLicenseCategories: "许可证类别",
  i18nViewCompleteLicenseText: "查看完整许可文本",
  i18nCompleteLicenseText: "完整许可文本",
  i18nAutofillBehavior: "填入行为",
  i18nAutofillModeHint: "选择复制，或复制后粘贴到上一个应用。",
  i18nClearClipboard: "清空剪贴板",
  i18nClearClipboardHint: "在复制后自动清空剪贴板。",
  i18nClipboardCopyOnly: "仅复制到剪贴板",
  i18nCopyAndPaste: "复制并粘贴",
  i18nCopyFailed: "复制失败",
  i18nGeneratedResult: "生成结果",
  i18nRecoveryCode: "恢复代码",
  i18nAppUpdate: "应用更新",
  i18nCheckForUpdates: "检查更新",
  i18nCheckingUpdates: "正在检查更新…",
  i18nCopying: "复制中",
  i18nCurrentWebVault: "当前 Web Vault",
  i18nDownloadAndRestart: "下载并重启",
  i18nDownloadingUpdate: "正在下载更新…",
  i18nDownloadingUpdateProgress: "正在下载更新 {0}%",
  i18nEnterShortcut: "请按快捷键",
  i18nHours: "{0} 小时",
  i18nLicense: "许可证",
  i18nNotSet: "未设置",
  i18nNewVersionAvailable: "发现新版本 {0}",
  i18nOpenWebVaultChangePassword: "打开 Web Vault 更改主密码",
  i18nPasswordHandoffDescription: "为安全完成密钥轮换和主密码验证，请在 Web Vault 中更改主密码。",
  i18nPinConfirm: "确认 PIN",
  i18nPinMismatch: "两次输入的 PIN 不一致。",
  i18nPinRequirement: "PIN 必须为 6 到 8 位数字。",
  i18nPinSetupDescription: "输入 6 到 8 位数字。PIN 会被安全保存；重新启动 Barwarden 后，需先使用主密码解锁一次。",
  i18nProjectSource: "上游 Bitwarden 源码",
  i18nRecordShortcut: "录制唤出 Barwarden 快捷键",
  i18nRecordShortcutPrompt: "请按快捷键，录制唤出 Barwarden 快捷键",
  i18nSeconds: "{0} 秒",
  i18nSetPin: "设置 PIN",
  i18nShortcutClear: "清除快捷键",
  i18nShortcutInUse: "快捷键已被占用",
  i18nShortcutInvalid: "请输入有效的快捷键",
  i18nShortcutOperationFailed: "快捷键操作失败",
  i18nShortcutUnavailable: "快捷键不可用",
  i18nShortcutUpdateFailed: "无法更新快捷键，请重试。",
  i18nShowBarwarden: "唤出 Barwarden",
  i18nTroubleshooting: "故障排除",
  i18nTroubleshootingHint: "账户、密码库和服务问题可在帮助中心继续处理。",
  i18nUnableToCopyRevision: "无法复制 revision",
  i18nUnableToOpenLinkTitle: "无法打开链接",
  i18nUpdateCheckFailed: "无法检查更新，请重试。",
  i18nUpdateInstallFailed: "无法下载或安装更新，请重试。",
  i18nUpdateUnsupported: "此环境不支持应用内更新。",
  i18nUpdateReadyToDownload: "已准备好下载更新。",
  i18nUpToDate: "当前已是最新版本。",
  i18nUnofficialMacClient: "非官方独立 macOS 菜单栏客户端。",
  i18nUpstreamRevision: "上游 revision",
  i18nVersion: "版本",
  i18nAppearance: "外观",
  i18nAutofill: "单字段填充",
  i18nAllowAutofill: "允许自动填充",
  i18nAccessibilityInstructions: "已复制到剪贴板。若要自动粘贴到其他应用，请在“系统设置”中允许 Barwarden 使用辅助功能。",
  i18nCallout: "通知",
  i18nCopiedLabel: "已复制{0}",
  i18nCopied: "已复制",
  i18nFilledLabel: "已填充{0}",
  i18nUnableToGenerateOtp: "无法生成验证码。",
  i18nUnableToCopyField: "无法复制字段。",
  i18nUnableToFillField: "无法填充字段。",
  i18nPasteUnavailableValueCopied: "无法粘贴，已复制内容。",
  i18nNoUri: "没有 URL。",
  i18nUnableToOpenUrl: "无法打开 URL。",
  i18nOpenedUrl: "已打开 URL。",
  i18nUnableToUpdateFavorite: "无法更新收藏状态。",
  i18nAddedToFavorites: "已添加到收藏夹。",
  i18nRemovedFromFavorites: "已从收藏夹移除。",
  i18nUnableToArchiveItem: "无法归档项目。",
  i18nArchivedItem: "项目已归档。",
  i18nUnableToDeleteItem: "无法删除项目。",
  i18nMovedItemToTrash: "项目已移至回收站。",
  i18nUnableToUnarchiveItem: "无法取消归档项目。",
  i18nItemUnarchived: "项目已取消归档。",
  i18nUnableToRestoreItem: "无法还原项目。",
  i18nArchivedItemRestored: "已还原归档项目。",
  i18nItemRestored: "项目已还原。",
  i18nUnableToPermanentlyDeleteItem: "无法永久删除项目。",
  i18nItemPermanentlyDeleted: "项目已永久删除。",
  i18nVaultChangedActionNotApplied: "密码库已变更，未应用此操作。",
  i18nVaultSessionUnavailable: "密码库会话不可用。",
  i18nItemUpdateInProgress: "项目更新正在进行中。",
  i18nFavoriteUpdateInProgress: "收藏状态更新正在进行中。",
  i18nSessionLocked: "会话已锁定。",
  i18nSyncedVaultData: "已同步 {0} 个项目和 {1} 个 Send。",
  i18nUnableToGenerateCredential: "无法生成凭据。",
  i18nUnableToUpdateGeneratorHistory: "无法更新生成器历史记录。",
  i18nLoggedOut: "已注销。",
  i18nOpen: "打开",
  i18nCopyAndFillField: "复制并填入{0}",
  i18nGoToSystemSettings: "前往系统设置",
  i18nLater: "稍后再说",
  i18nOpening: "正在打开…",
  i18nOfficialUiPrimitives: "官方界面原语",
  i18nUnavailable: "不可用",
  i18nOpenSystemSettingsFailed: "无法打开系统设置，请稍后重试。",
  i18nCompactMode: "紧凑模式",
  i18nInterface: "界面",
  i18nKeyboardShortcuts: "快捷键",
  i18nAllowKeychainAndRetry: "允许钥匙串访问后重试。",
  i18nBarwardenRestoreFailed: "无法恢复 Barwarden",
  i18nBrokerUnavailableMessage: "无法连接 Barwarden 的共享窗口会话。",
  i18nBrokerUnavailableTitle: "窗口会话不可用",
  i18nCodeEmailFailed: "无法发送验证码邮件。请重试。",
  i18nCodeEmailSent: "验证码邮件已发送。",
  i18nInvalidMasterPassword: "主密码无效。请确认电子邮箱和服务器地址。",
  i18nInvalidMasterPasswordRetry: "主密码无效。请确认后重试。",
  i18nKeychainAfterVerification: "已验证主密码，但无法访问钥匙串。请允许访问后重试。",
  i18nLoginExpired: "登录验证已过期。请重新登录。",
  i18nLoginRateLimited: "登录尝试过于频繁。请稍后重试。",
  i18nLoginRejected: "服务器拒绝了登录请求。请检查账户和服务器设置。",
  i18nLoginServerUnavailable: "服务器暂时无法完成登录。请稍后重试。",
  i18nLoginSyncFailed: "登录成功，但无法同步密码库。请稍后重试。",
  i18nLoginTimeout: "登录超时。请检查服务器连接后重试。",
  i18nMasterPasswordHintSent: "我们已经向您发送了一封包含主密码提示的电子邮件。",
  i18nNoLockedAccount: "没有已锁定的账户。",
  i18nNoUnlockableAccount: "没有可解锁的账户。",
  i18nNoPendingEmailTwoFactor: "没有待处理的邮箱两步登录请求。",
  i18nNoPendingNewDeviceLogin: "没有待处理的新设备登录请求。",
  i18nNoPendingTwoFactorLogin: "没有待处理的两步登录请求。",
  i18nPinIncorrect: "PIN 不正确。请重试。",
  i18nPinIncorrectAttempts: "PIN 不正确，还可尝试 {0} 次。",
  i18nPinUnavailable: "PIN 当前不可用，请使用主密码解锁。",
  i18nPinInvalidated: "PIN 已失效，请使用主密码解锁。",
  i18nRequestPasswordHintFailed: "无法请求密码提示。请检查服务器连接后重试。",
  i18nSaveAccountFailed: "保存账户失败。请重试。",
  i18nSessionRestoreNeeded: "会话需要恢复。请重试。",
  i18nSessionRestoreStatus: "会话需要恢复。密码库数据仍保留，请重试。",
  i18nUnableToLoadAccount: "无法读取账户信息。请重试或使用主密码解锁。",
  i18nUnableToLogin: "无法登录。请重试。",
  i18nUnableToLoginServer: "无法登录。请检查服务器连接后重试。",
  i18nUnableToCompleteNavigation: "无法完成页面跳转。请重试。",
  i18nUnableToNavigate: "无法打开下一页。请重试。",
  i18nUnableToUnlock: "无法解锁。请重试。",
  i18nUnableToCompleteAccountAction: "无法完成账户操作。请重试。",
  i18nUnableToConnectServer: "无法连接服务器。请检查网络和服务器地址后重试。",
  i18nUnableToUnlockWithMasterPassword: "无法解锁。请使用主密码重试。",
  i18nUnlockSessionFailed: "无法恢复密码库会话。请使用主密码解锁。",
  i18nTouchIdFailed: "Touch ID 解锁失败。请重试或使用其他方式。",
  i18nTouchIdInvalidated: "Touch ID 已失效，请使用其他方式解锁，或使用主密码重新启用。",
  i18nTouchIdUnavailable: "Touch ID 当前不可用，请使用其他方式解锁。",
  i18nTwoFactorAppDescription: "使用验证器应用中的验证码",
  i18nTwoFactorEmailDescription: "通过电子邮箱接收验证码",
  i18nTwoFactorError: "两步登录错误",
  i18nTwoFactorVerificationFailed: "无法验证代码。请重试。",
  i18nUnsupportedTwoFactor: "此账户已设置两步登录，但此浏览器不支持任何已配置的两步登录提供程序。",
  i18nUseMasterPassword: "使用主密码",
  i18nUsePin: "使用 PIN",
  i18nUseTouchId: "使用 Touch ID",
  i18nUnlockWithTouchId: "使用 Touch ID 解锁",
  i18nLoadingUnlockMethods: "正在载入解锁方式",
  i18nLocalAccountUnavailableMessage: "请重新登录以重建本地账户数据。",
  i18nLocalAccountUnavailableTitle: "本地账户数据不可用",
  i18nKeychainUnavailableTitle: "无法访问钥匙串",
  i18nRecoveringSession: "正在恢复会话",
  i18nRelogin: "重新登录",
  i18nRetryOrRelogin: "请重试；如果问题持续，请重新登录。",
  i18nRetry: "重试",
  i18nReunlock: "重新解锁",
  i18nSessionExpiredMessage: "请重新解锁此账户。",
  i18nSessionExpiredTitle: "会话已失效",
  i18nStarting: "正在启动…",
  i18nStartupNavigationFailed: "无法完成启动页面加载。请重新打开应用。",
  i18nStartupTimeoutMessage: "Barwarden 未能及时恢复会话，请重试。",
  i18nStartupTimeoutTitle: "恢复会话超时",
  i18nSyncIncompleteMessage: "已保留本地数据；连接恢复后可重试。",
  i18nSyncIncompleteTitle: "同步未完成",
  i18nSyncVaultFailed: "无法同步密码库",
  i18nSyncVaultFailedRetry: "无法同步密码库。请重试。",
  i18nTheme: "主题",
  i18nThemeDark: "深色",
  i18nThemeLight: "浅色",
  i18nTransportMessage: "请检查网络和服务器地址后重试。",
  i18nTransportTitle: "无法连接服务器",
  i18nVaultOptions: "密码库选项",
  i18nShowFavicons: "显示网站图标",
  i18nShowQuickCopyActions: "在密码库上显示快速复制操作",
  i18nRetrySession: "重试会话",
  i18nSessionRestoreRequired: "会话需要恢复",
  itemsWithNoFolder: "无文件夹的项目",
  labelWithNotification: "{0}，有通知",
  loading: "正在加载",
  multipleInputEmails: "请输入有效的电子邮件地址。",
  new: "新增",
  m2ShellLongTranslation: "这是一个用于验证官方本地化管道在固定弹窗宽度内完整保留可访问文本的确定性长翻译文本",
  popOutNewWindow: "在新窗口中打开",
  backTo: "返回 {0}",
  archive: "归档",
  folders: "文件夹",
  removeItem: "移除 {0}",
  required: "必填",
  save: "保存",
  resetSearch: "重置搜索",
  search: "搜索",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  selfHostedBaseUrlHint: "https://server.example.com",
  selfHostedEnvironment: "自托管环境",
  selfHostedEnvFormInvalid: "URL 必须使用 HTTPS。",
  selfHostedServer: "自托管环境",
  cancel: "取消",
  selectPlaceholder: "-- 选择 --",
  send: "Send",
  settings: "设置",
  syncNow: "立即同步",
  trash: "回收站",
  switchAccount: "切换账户",
  toggleVisibility: "切换可见性",
  twoStepLogin: "两步登录",
  type: "类型",
  typeCard: "支付卡",
  typeIdentity: "身份",
  typeLogin: "登录",
  typeNote: "笔记",
  unlock: "解锁",
  vault: "密码库",
  viewItemsIn: "查看 {0} 中的项目",
  warning: "警告",
};

const englishTranslations: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(englishMessages).map(([id, message]) => [id, message.message]),
  ),
  locked: "Locked",
  copyCardholderName: "Copy cardholder name",
  copied: "Copied",
  i18nEnglish: "English",
  i18nFollowSystem: "Follow system",
  i18nLanguage: "Language",
  i18nPrimaryNavigation: "Primary navigation",
  i18nSimplifiedChinese: "Simplified Chinese",
  i18nBitwardenService: "Bitwarden service",
  i18nBarwardenProductLabel: "Barwarden, a Bitwarden service client",
  i18nAccountInfoRetained: "Your account information is still available. Unlock again.",
  i18nAbout: "About",
  i18nAddTextSend: "Add text Send",
  i18nAllSends: "All Sends",
  i18nAnyoneWithLink: "Anyone with the link",
  i18nAnyoneWithPassword: "Anyone with the password",
  i18nCopySendLink: "Copy link",
  i18nCopySendLinkFailed: "Unable to copy the Send link. Try again.",
  i18nCopySendPasswordFailed: "Unable to copy the Send password. Try again.",
  i18nCopiedSendPassword: "Copied Send password",
  i18nCreateSend: "Create Send",
  i18nDays: "{0} days",
  i18nDefaultHideText: "Hide text by default",
  i18nDeleteDate: "Deletion date",
  i18nDeleteDateValue: "Deletion date: {0}",
  i18nCopySendLinkFor: "Copy link - {0}",
  i18nDeleteSendFor: "Delete - {0}",
  i18nDeleteSendFailed: "Unable to delete the Send. Try again.",
  i18nDeleteSendTitle: "Permanently delete Send “{0}”?",
  i18nDeletingSend: "Deleting…",
  i18nDiscardSendContent: "Your changes to this Send will not be saved.",
  i18nDiscardSendTitle: "Discard unsaved changes?",
  i18nEditTextSend: "Edit text Send",
  i18nExpired: "Expired",
  i18nFilterSend: "Filter Sends",
  i18nGeneratingPasswordFailed: "Unable to generate a password. Try again.",
  i18nHideEmailFromRecipients: "Hide my email address from recipients.",
  i18nLoadingSends: "Loading Sends",
  i18nLoadingVault: "Loading vault",
  i18nMaxAccessCount: "Maximum access count",
  i18nMaxAccessCountHint: "No one can view this Send after the limit is reached.",
  i18nMaxAccessReached: "Maximum access count reached",
  i18nNewPassword: "New password",
  i18nNoMatchingSends: "No matching Sends",
  i18nOrganizationPolicyDisabledSend: "An organization policy has disabled Bitwarden Send.",
  i18nOrganizationPolicyDisabledSendStatus: "Send is disabled by organization policy.",
  i18nPasswordProtected: "Password protected",
  i18nPasswordRequiredForSend: "A password is required to access this Send.",
  i18nPermanentDeleteSend: "Permanently delete Send?",
  i18nPermanentDeleteSendContent: "“{0}” will be permanently deleted. This action cannot be undone.",
  i18nPrivateNotes: "Private notes",
  i18nRemove: "Remove",
  i18nRemoveSendPassword: "Remove Send password?",
  i18nRemoveSendPasswordContent: "After removal, anyone with the link can access this Send.",
  i18nRemoveSendPasswordFailed: "Unable to remove the Send password. Try again.",
  i18nSearchSend: "Search Sends",
  i18nSendCreated: "Send created",
  i18nSendCreatedSuccess: "Send created successfully",
  i18nSendDeletionHint: "The Send will be deleted after the selected time.",
  i18nSendDetails: "Send details",
  i18nSendDisabled: "Send disabled",
  i18nSendEmptyDescription: "Securely share end-to-end encrypted information on any platform.",
  i18nSendEmptyTitle: "Securely send sensitive information",
  i18nSendExpires: "The Send you created expires in {0}.",
  i18nSendNotFound: "This Send could not be found",
  i18nSendName: "Send name",
  i18nSendLinkCopied: "Send link copied",
  i18nSendDeleted: "Send deleted",
  i18nSendPasswordExpires: "The password-protected Send you created expires in {0}.",
  i18nSendPolicyViolation: "Send violates organization policy",
  i18nTextSend: "Text Send",
  i18nTextToShare: "Text to share",
  i18nUnlockBeforeCreatingSend: "Unlock the vault before creating a Send.",
  i18nUnableToSaveSend: "Unable to save the Send. Try again.",
  i18nViewTextSend: "View text Send",
  i18nWhoCanAccess: "Who can access",
  i18nContinueEditing: "Continue editing",
  i18nGeneral: "General",
  i18nLaunchAtLogin: "Launch at Login",
  i18nLaunchAtLoginHint: "Keep Barwarden in the menu bar",
  i18nAccountSecurity: "Account security",
  i18nAccountChangedReverify: "The account changed. Verify your master password again.",
  i18nChangeMasterPassword: "Change master password",
  i18nContinueInWebVault: "Continue in the Web Vault",
  i18nHours: "{0} hours",
  i18nImmediately: "Immediately",
  i18nLockAction: "Lock",
  i18nLogOutAction: "Log out",
  i18nNever: "Never",
  i18nMinutes: "{0} minutes",
  i18nOtherOptions: "Other options",
  i18nPinDeviceHint: "The PIN is stored encrypted on this device. After restarting the app, unlock once with your master password.",
  i18nSessionTimeout: "Session timeout",
  i18nSyncing: "Syncing",
  i18nNeverSynced: "Never synced",
  i18nTouchIdCheckSettings: "Touch ID is unavailable. Check System Settings.",
  i18nTouchIdCleanupFailed: "Touch ID was enabled but could not be cleaned up. Return to the original account and disable Touch ID.",
  i18nTouchIdLocked: "Touch ID is locked. Restore it in System Settings first.",
  i18nTouchIdNotAvailableMac: "Touch ID is unavailable on this Mac.",
  i18nTouchIdNotEnrolled: "Set up Touch ID in System Settings first.",
  i18nUnableToDisableTouchId: "Unable to disable Touch ID. Try again.",
  i18nUnableToEnableTouchId: "Unable to enable Touch ID. Try again.",
  i18nUnableToOpenLink: "Unable to open the link. Try again.",
  i18nUnableToOpenWebVault: "Unable to open the Web Vault",
  i18nUnableToReadUnlockOptions: "Unable to load unlock options. Try again.",
  i18nUnableToSetPin: "Unable to set the PIN. Try again.",
  i18nUnableToUpdateUnlockMethod: "Unable to update the unlock method",
  i18nUnableToUpdateLaunchAtLoginTitle: "Unable to update launch at login",
  i18nUnableToUpdateLaunchAtLogin: "Could not change the login item. Try again.",
  i18nUnlockOptions: "Unlock options",
  i18nUsePinToUnlock: "Unlock with PIN",
  i18nVaultTimeout: "Vault timeout",
  i18nVaultTimeoutAction: "Vault timeout action",
  i18nAllItems: "All items",
  favorites: "Favorites",
  items: "Items",
  searchVault: "Search vault",
  searchResults: "Search results",
  i18nAddItemType: "Add {0}",
  i18nCloneItemType: "Clone {0}",
  i18nEditItemType: "Edit {0}",
  i18nArchived: "Archived",
  i18nArchiveItemQuestion: "Archive {0}?",
  i18nArchiveItems: "Archived items",
  i18nArchiveOptions: "Archive options for {0}",
  i18nArchivedItemsHint: "Archived items will appear here.",
  i18nNoArchivedItems: "No archived items",
  i18nDeletedItemsHint: "Deleted items will appear here.",
  i18nDateUnavailable: "Date unavailable",
  i18nAddFavorite: "Add to favorites",
  i18nRemoveFavorite: "Remove from favorites",
  i18nEditFolder: "Edit folder",
  i18nEditFolderLabel: "Edit folder {0}",
  i18nFolderHelp: "Folders help organize your vault items.",
  i18nFolderValue: "Folder: {0}",
  i18nFolderName: "Folder name",
  i18nNoFolders: "No folders",
  i18nNoPasswords: "No passwords in the list",
  i18nMore: "More",
  i18nTrashAutoDeleteMessage: "Items in the trash for more than 30 days are automatically deleted.",
  i18nTrashAutoDeleteTitle: "Items are automatically deleted",
  i18nTrashItems: "Items in trash",
  i18nTrashOptions: "Trash options for {0}",
  i18nNoTrashItems: "No items in trash",
  i18nViewItem: "View item {0}",
  i18nView: "View",
  i18nClone: "Clone",
  i18nSaving: "Saving...",
  i18nUnableToCreateFolder: "Unable to create folder",
  i18nUnableToUpdateFolder: "Unable to update folder",
  i18nDeleteFolder: "Delete folder",
  i18nChooseItemToAdd: "Choose an item to add",
  i18nCannotUndo: "This action cannot be undone.",
  i18nConfirmArchive: "Confirm archive",
  i18nConfirmDelete: "Confirm delete",
  i18nConfirm: "Confirm",
  i18nConfirmMasterPassword: "Confirm master password",
  i18nConfirmPermanentDelete: "Confirm permanent deletion",
  i18nDeleteItemQuestion: "Delete {0}?",
  i18nDeleteItemTitle: "Delete item?",
  i18nArchiveDeleteContent: "This item will be moved to the trash, where you can restore it later.",
  i18nDeleting: "Deleting...",
  i18nDeleteFolderContent: "Items in this folder will remain in your vault after the folder is deleted. This action cannot be undone.",
  i18nDeleteFolderFailed: "Unable to delete the folder. Try again.",
  i18nDiscard: "Discard",
  i18nDiscardChangesContent: "You have unsaved changes. Are you sure you want to discard them?",
  i18nDiscardChangesTitle: "Discard changes?",
  i18nDelete: "Delete",
  i18nEdit: "Edit",
  i18nEmptyVaultDescription: "Your vault protects more than passwords. You can also securely store logins, identities, cards, and notes here.",
  i18nEmptyVaultTitle: "Your vault is empty",
  i18nEnterMasterPassword: "Enter your master password.",
  i18nIncorrectMasterPassword: "The master password is incorrect.",
  i18nNoFoldersYet: "No folders yet",
  i18nNoItemsInCategory: "There are no items in this category",
  i18nNoItemsInNode: "There are no items in this section",
  i18nVaultCategories: "Vault categories",
  i18nFolderDescription: "Organize vault items",
  i18nHiddenItems: "Hidden items",
  i18nIdentityDescription: "Save names, email addresses, phone numbers, and addresses",
  i18nItem: "Item",
  i18nItemNotFound: "Item not found.",
  i18nItemSavedOpenFailed: "The item was saved but could not be opened.",
  i18nLoginDescription: "Save usernames, passwords, TOTP codes, and website URIs",
  i18nNewFolder: "New folder",
  i18nNewLogin: "New login",
  i18nNoFolder: "No folder",
  i18nNoSearchMatches: "No items match your search",
  i18nNoSearchMatchesHint: "Clear filters or try another search term",
  i18nPermanentDeleteItemQuestion: "Permanently delete {0}?",
  i18nPermanentDeleteItemTitle: "Permanently delete item?",
  i18nPermanentDeleteItemContent: "This action cannot be undone. The item will be permanently deleted from your vault.",
  i18nPermanentDelete: "Permanently delete",
  i18nPermanentDeleteFolder: "Permanently delete folder?",
  i18nPopOut: "Pop out to a new window",
  i18nRestore: "Restore",
  i18nSaveCardDescription: "Save card numbers, expiration dates, and security codes",
  i18nSaveIdentityDescription: "Save names, email addresses, phone numbers, and addresses",
  i18nSaveItemFailed: "Unable to save the item. Try again.",
  i18nSaveFolderFailed: "Unable to save the folder. Try again.",
  i18nSaveSecureNoteDescription: "Save notes that only need encrypted text",
  i18nSecureNote: "Secure note",
  i18nSshKey: "SSH key",
  i18nSyncBeforeEdit: "Sync the vault before editing this item.",
  i18nSyncFailedShowingSavedVault: "Unable to sync. Showing saved vault data.",
  i18nVaultLoadFailed: "Unable to load the vault. Try again.",
  i18nUnableToVerifyMasterPassword: "Unable to verify the master password.",
  i18nCopyField: "Copy {0}",
  i18nFillField: "Fill {0} field",
  i18nFill: "Fill",
  i18nCardNumber: "Card number",
  i18nPassportNumber: "Passport number",
  i18nSsn: "Social Security number",
  i18nHideField: "Hide {0}",
  i18nOpenField: "Open {0}",
  i18nShowField: "Show {0}",
  i18nCopyOtpForItem: "Copy the verification code for {0}",
  i18nCopiedOtpForItem: "Copied the verification code for {0}",
  i18nCopyVerificationCode: "Copy verification code",
  i18nFillVerificationCode: "Fill verification code field",
  i18nGeneratingVerificationCode: "Generating verification code",
  i18nGenerating: "Generating…",
  i18nGeneratorHistoryFailed: "Generator history operation failed",
  i18nGeneratorHistoryClearFailed: "Unable to clear generator history.",
  i18nGeneratorHistoryCopyFailed: "Unable to copy generated content.",
  i18nGeneratorHistoryLoadFailed: "Unable to load generator history.",
  i18nNoMatchingVerificationCodes: "No verification codes match your search",
  i18nNoVerificationCodes: "There are no verification codes in your vault",
  i18nSearchVerificationCodes: "Search verification codes",
  i18nVerificationCodeExpires: "Verification code expires in {0} seconds",
  i18nVerificationCodeUnavailable: "Verification code unavailable",
  i18nItemsCount: "Items ({0})",
  i18nUnableToCompleteOperation: "Unable to complete the operation. Try again.",
  i18nVerifying: "Verifying...",
  i18nVaultRepromptDescription: "This item requires your master password before protected information can be viewed or used.",
  i18nUnarchive: "Unarchive",
  i18nWebsite: "Website",
  i18nVaultMayBeOutdated: "The vault may be out of date",
  i18nViewItemType: "View {0}",
  i18nAnimations: "Show animations",
  i18nAboutProduct: "About {0}",
  i18nThirdPartyOpenSourceLicenses: "Third-party open-source licenses",
  i18nThirdPartyLicenseSummaryDescription:
    "Barwarden includes third-party open-source components distributed with the macOS application. Development, test, build, and other-platform dependencies are excluded.",
  i18nNpmRuntimeComponents: "npm runtime components",
  i18nCargoRuntimeComponents: "Cargo runtime components",
  i18nRuntimeComponents: "Runtime components",
  i18nLicenseCategories: "License categories",
  i18nViewCompleteLicenseText: "View complete license text",
  i18nCompleteLicenseText: "Complete license text",
  i18nAutofillBehavior: "Fill behavior",
  i18nAutofillModeHint: "Choose whether to copy, or copy and paste into the previous app.",
  i18nClearClipboard: "Clear clipboard",
  i18nClearClipboardHint: "Automatically clear the clipboard after copying.",
  i18nClipboardCopyOnly: "Copy to clipboard only",
  i18nCopyAndPaste: "Copy and paste",
  i18nCopyFailed: "Copy failed",
  i18nGeneratedResult: "generated result",
  i18nRecoveryCode: "recovery code",
  i18nAppUpdate: "Application updates",
  i18nCheckForUpdates: "Check for updates",
  i18nCheckingUpdates: "Checking for updates…",
  i18nCopying: "Copying",
  i18nCurrentWebVault: "Current Web Vault",
  i18nDownloadAndRestart: "Download and restart",
  i18nDownloadingUpdate: "Downloading update…",
  i18nDownloadingUpdateProgress: "Downloading update {0}%",
  i18nEnterShortcut: "Press a shortcut",
  i18nLicense: "License",
  i18nNotSet: "Not set",
  i18nNewVersionAvailable: "Version {0} is available",
  i18nOpenWebVaultChangePassword: "Open the Web Vault to change master password",
  i18nPasswordHandoffDescription: "To securely complete sensitive account changes and master-password verification, change your master password in the Web Vault.",
  i18nPinConfirm: "Confirm PIN",
  i18nPinMismatch: "The PINs do not match.",
  i18nPinRequirement: "The PIN must contain 6 to 8 digits.",
  i18nPinSetupDescription: "Enter 6 to 8 digits. The PIN is stored securely. After restarting Barwarden, unlock once with your master password.",
  i18nProjectSource: "Upstream Bitwarden source",
  i18nRecordShortcut: "Record the shortcut that opens Barwarden",
  i18nRecordShortcutPrompt: "Press a shortcut to record the shortcut that opens Barwarden",
  i18nSeconds: "{0} seconds",
  i18nSetPin: "Set PIN",
  i18nShortcutClear: "Clear shortcut",
  i18nShortcutInUse: "The shortcut is already in use",
  i18nShortcutInvalid: "Enter a valid shortcut",
  i18nShortcutOperationFailed: "Shortcut operation failed",
  i18nShortcutUnavailable: "Shortcut unavailable",
  i18nShortcutUpdateFailed: "Unable to update the shortcut. Try again.",
  i18nShowBarwarden: "Show Barwarden",
  i18nTroubleshooting: "Troubleshooting",
  i18nTroubleshootingHint: "Continue resolving account, vault, and service issues in the Help Center.",
  i18nUnableToCopyRevision: "Unable to copy revision",
  i18nUnableToOpenLinkTitle: "Unable to open link",
  i18nUpdateCheckFailed: "Unable to check for updates. Try again.",
  i18nUpdateInstallFailed: "Unable to download or install the update. Try again.",
  i18nUpdateUnsupported: "In-app updates are unavailable in this environment.",
  i18nUpdateReadyToDownload: "The update is ready to download.",
  i18nUpToDate: "Barwarden is up to date.",
  i18nUnofficialMacClient: "Unofficial independent macOS menu bar client.",
  i18nUpstreamRevision: "Upstream revision",
  i18nVersion: "Version",
  i18nAppearance: "Appearance",
  i18nAutofill: "Autofill",
  i18nAllowAutofill: "Allow autofill",
  i18nAccessibilityInstructions: "Copied to the clipboard. To paste automatically into other apps, allow Barwarden to use Accessibility in System Settings.",
  i18nCallout: "Notification",
  i18nCopiedLabel: "Copied {0}",
  i18nCopied: "Copied",
  i18nFilledLabel: "Filled {0}",
  i18nUnableToGenerateOtp: "Unable to generate OTP",
  i18nUnableToCopyField: "Unable to copy field.",
  i18nUnableToFillField: "Unable to fill field.",
  i18nPasteUnavailableValueCopied: "Paste unavailable; value copied.",
  i18nNoUri: "No URI",
  i18nUnableToOpenUrl: "Unable to open URL.",
  i18nOpenedUrl: "Opened URL",
  i18nUnableToUpdateFavorite: "Unable to update favorite.",
  i18nAddedToFavorites: "Added to favorites",
  i18nRemovedFromFavorites: "Removed from favorites",
  i18nUnableToArchiveItem: "Unable to archive item.",
  i18nArchivedItem: "Archived item",
  i18nUnableToDeleteItem: "Unable to delete item.",
  i18nMovedItemToTrash: "Moved item to trash",
  i18nUnableToUnarchiveItem: "Unable to unarchive item.",
  i18nItemUnarchived: "Item unarchived",
  i18nUnableToRestoreItem: "Unable to restore item.",
  i18nArchivedItemRestored: "Archived item restored",
  i18nItemRestored: "Item restored",
  i18nUnableToPermanentlyDeleteItem: "Unable to permanently delete item.",
  i18nItemPermanentlyDeleted: "Item permanently deleted",
  i18nVaultChangedActionNotApplied: "Vault changed; action not applied.",
  i18nVaultSessionUnavailable: "Vault session is unavailable.",
  i18nItemUpdateInProgress: "Item update already in progress.",
  i18nFavoriteUpdateInProgress: "Favorite update already in progress.",
  i18nSessionLocked: "Session locked",
  i18nSyncedVaultData: "Synced {0} items and {1} sends",
  i18nUnableToGenerateCredential: "Unable to generate credential",
  i18nUnableToUpdateGeneratorHistory: "Unable to update generator history",
  i18nLoggedOut: "Logged out",
  i18nOpen: "Open",
  i18nCopyAndFillField: "Copy and fill {0}",
  i18nGoToSystemSettings: "Open System Settings",
  i18nLater: "Not now",
  i18nOpening: "Opening…",
  i18nOfficialUiPrimitives: "Official UI primitives",
  i18nUnavailable: "Unavailable",
  i18nOpenSystemSettingsFailed: "Unable to open System Settings. Try again later.",
  i18nCompactMode: "Compact mode",
  i18nInterface: "Interface",
  i18nKeyboardShortcuts: "Keyboard shortcuts",
  i18nAllowKeychainAndRetry: "Allow keychain access and try again.",
  i18nBarwardenRestoreFailed: "Unable to restore Barwarden",
  i18nBrokerUnavailableMessage: "Unable to connect to Barwarden's shared window session.",
  i18nBrokerUnavailableTitle: "Window session unavailable",
  i18nCodeEmailFailed: "Unable to send the verification code email. Please try again.",
  i18nCodeEmailSent: "Verification code email sent.",
  i18nInvalidMasterPassword: "Invalid master password. Check your email and server address.",
  i18nInvalidMasterPasswordRetry: "Invalid master password. Check it and try again.",
  i18nKeychainAfterVerification: "Your master password was verified, but the keychain could not be accessed. Allow access and try again.",
  i18nLoginExpired: "Your login verification expired. Log in again.",
  i18nLoginRateLimited: "Too many login attempts. Try again later.",
  i18nLoginRejected: "The server rejected the login request. Check your account and server settings.",
  i18nLoginServerUnavailable: "The server cannot complete the login right now. Try again later.",
  i18nLoginSyncFailed: "Login succeeded, but your vault could not be synced. Try again later.",
  i18nLoginTimeout: "Login timed out. Check the server connection and try again.",
  i18nMasterPasswordHintSent: "We sent you an email containing your master password hint.",
  i18nNoLockedAccount: "There is no locked account.",
  i18nNoUnlockableAccount: "There is no account to unlock.",
  i18nNoPendingEmailTwoFactor: "There is no pending email two-step login request.",
  i18nNoPendingNewDeviceLogin: "There is no pending new-device login request.",
  i18nNoPendingTwoFactorLogin: "There is no pending two-step login request.",
  i18nPinIncorrect: "Incorrect PIN. Try again.",
  i18nPinIncorrectAttempts: "Incorrect PIN. {0} attempts remaining.",
  i18nPinUnavailable: "PIN is unavailable. Unlock with your master password.",
  i18nPinInvalidated: "Your PIN expired. Unlock with your master password.",
  i18nRequestPasswordHintFailed: "Unable to request a password hint. Check the server connection and try again.",
  i18nSaveAccountFailed: "Unable to save the account. Try again.",
  i18nSessionRestoreNeeded: "The session needs to be restored. Try again.",
  i18nSessionRestoreStatus: "The session needs to be restored. Your vault data is still available; try again.",
  i18nUnableToLoadAccount: "Unable to load account information. Try again or unlock with your master password.",
  i18nUnableToLogin: "Unable to log in. Try again.",
  i18nUnableToLoginServer: "Unable to log in. Check the server connection and try again.",
  i18nUnableToCompleteNavigation: "Unable to complete navigation. Try again.",
  i18nUnableToNavigate: "Unable to open the next page. Try again.",
  i18nUnableToUnlock: "Unable to unlock. Try again.",
  i18nUnableToCompleteAccountAction: "Unable to complete the account action. Try again.",
  i18nUnableToConnectServer: "Unable to connect to the server. Check the network and server address, then try again.",
  i18nUnableToUnlockWithMasterPassword: "Unable to unlock. Try again with your master password.",
  i18nUnlockSessionFailed: "Unable to restore the vault session. Unlock with your master password.",
  i18nTouchIdFailed: "Touch ID unlock failed. Try again or use another method.",
  i18nTouchIdInvalidated: "Touch ID is no longer available. Use another unlock method, or re-enable it with your master password.",
  i18nTouchIdUnavailable: "Touch ID is unavailable. Use another unlock method.",
  i18nTwoFactorAppDescription: "Use a verification code from your authenticator app",
  i18nTwoFactorEmailDescription: "Receive a verification code by email",
  i18nTwoFactorError: "Two-step login error",
  i18nTwoFactorVerificationFailed: "Unable to verify the code. Try again.",
  i18nUnsupportedTwoFactor: "This account uses two-step login, but none of its configured providers are supported by this browser.",
  i18nUseMasterPassword: "Use master password",
  i18nUsePin: "Use PIN",
  i18nUseTouchId: "Use Touch ID",
  i18nUnlockWithTouchId: "Unlock with Touch ID",
  i18nLoadingUnlockMethods: "Loading unlock methods",
  i18nLocalAccountUnavailableMessage: "Log in again to rebuild the local account data.",
  i18nLocalAccountUnavailableTitle: "Local account data unavailable",
  i18nKeychainUnavailableTitle: "Unable to access the keychain",
  i18nRecoveringSession: "Restoring session",
  i18nRelogin: "Log in again",
  i18nRetryOrRelogin: "Try again. If the problem continues, log in again.",
  i18nRetry: "Retry",
  i18nReunlock: "Unlock again",
  i18nSessionExpiredMessage: "Unlock this account again.",
  i18nSessionExpiredTitle: "Session expired",
  i18nStarting: "Starting…",
  i18nStartupNavigationFailed: "Unable to load the startup page. Reopen the app.",
  i18nStartupTimeoutMessage: "Barwarden could not restore the session in time. Try again.",
  i18nStartupTimeoutTitle: "Session restoration timed out",
  i18nSyncIncompleteMessage: "Local data was preserved. Try again when the connection recovers.",
  i18nSyncIncompleteTitle: "Sync incomplete",
  i18nSyncVaultFailed: "Unable to sync the vault",
  i18nSyncVaultFailedRetry: "Unable to sync the vault. Try again.",
  i18nTheme: "Theme",
  i18nThemeDark: "Dark",
  i18nThemeLight: "Light",
  i18nTransportMessage: "Check the network and server address, then try again.",
  i18nTransportTitle: "Unable to connect to the server",
  i18nVaultOptions: "Vault options",
  i18nShowFavicons: "Show website icons",
  i18nShowQuickCopyActions: "Show quick-copy actions in the vault",
  i18nRetrySession: "Retry session",
  i18nSessionRestoreRequired: "Session restoration required",
  showPassword: "Show password",
  hidePassword: "Hide password",
  archive: "Archive",
  m2ShellLongTranslation:
    "This deterministic long translation verifies that the retained official localization pipe preserves accessible text within the fixed popup width.",
};

export type OfficialLocale = "zh-CN" | "en-US";

export function resolveOfficialLocale(systemLanguage: unknown): OfficialLocale {
  return typeof systemLanguage === "string" && /^zh(?:-|$)/iu.test(systemLanguage.trim())
    ? "zh-CN"
    : "en-US";
}

const sharedLocaleSubject = new BehaviorSubject<OfficialLocale>(
  resolveOfficialLocale(globalThis.navigator?.language),
);
const sharedUserSetLocaleSubject = new BehaviorSubject<string | undefined>(
  sharedLocaleSubject.value,
);
let sharedCollator = new Intl.Collator(sharedLocaleSubject.value);

export function activeOfficialLocale(): OfficialLocale {
  return sharedLocaleSubject.value;
}

export function translateOfficialMessage(
  id: string,
  p1?: string | number,
  p2?: string | number,
  p3?: string | number,
): string {
  const locale = sharedLocaleSubject.value;
  const retainedMessage =
    locale === "zh-CN"
      ? (officialPersonalFormZhCnMessages as Readonly<Record<string, OfficialMessage>>)[id] ??
        (officialFormZhCnMessages as Readonly<Record<string, OfficialMessage>>)[id]
      : undefined;
  const vendorMessage =
    locale === "en-US"
      ? (englishMessages[id as keyof typeof englishMessages] as OfficialMessage | undefined)
      : undefined;
  const translation =
    retainedMessage?.message ??
    (locale === "zh-CN" ? translations[id] : englishTranslations[id]);
  const placeholderMessage =
    retainedMessage ??
    (vendorMessage?.message === translation ? vendorMessage : undefined);

  if (translation === undefined) {
    throw new Error(`Unsupported official UI translation key: ${id}`);
  }

  let resolved = translation;
  const parameters = [p1, p2, p3];
  if (placeholderMessage?.placeholders) {
    for (const [name, placeholder] of Object.entries(placeholderMessage.placeholders)) {
      const parameterIndex = Number.parseInt(placeholder.content.slice(1), 10) - 1;
      const parameter = parameters[parameterIndex];
      resolved = resolved.replaceAll(
        `$${name.toUpperCase()}$`,
        parameter === undefined ? "" : String(parameter),
      );
    }
  } else {
    for (const [index, parameter] of parameters.entries()) {
      resolved = resolved.replace(
        `{${index}}`,
        parameter === undefined ? "" : String(parameter),
      );
    }
  }

  return resolved;
}

@Injectable()
export class OfficialI18nService extends I18nService {
  readonly supportedTranslationLocales: OfficialLocale[] = ["zh-CN", "en-US"];
  get translationLocale(): OfficialLocale {
    return sharedLocaleSubject.value;
  }
  get collator(): Intl.Collator {
    return sharedCollator;
  }
  readonly localeNames = new Map<OfficialLocale, string>([
    ["zh-CN", "简体中文"],
    ["en-US", "English"],
  ]);

  readonly locale$: Observable<string> = sharedLocaleSubject.asObservable();
  readonly userSetLocale$: Observable<string | undefined> = sharedUserSetLocaleSubject.asObservable();

  async setLocale(locale: string | null): Promise<void> {
    const nextLocale = locale ?? resolveOfficialLocale(globalThis.navigator?.language);
    if (nextLocale !== "zh-CN" && nextLocale !== "en-US") {
      throw new Error(`Unsupported official UI locale: ${locale}`);
    }

    sharedCollator = new Intl.Collator(nextLocale);
    sharedLocaleSubject.next(nextLocale);
    sharedUserSetLocaleSubject.next(nextLocale);
  }

  async init(): Promise<void> {}

  t(
    id: string,
    p1?: string | number,
    p2?: string | number,
    p3?: string | number,
  ): string {
    return translateOfficialMessage(id, p1, p2, p3);
  }

  translate(id: string, p1?: string, p2?: string, p3?: string): string {
    return this.t(id, p1, p2, p3);
  }
}
