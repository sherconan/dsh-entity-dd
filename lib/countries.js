/** ISO 3166-1 alpha-2 → Chinese name, for the jurisdictions this plugin meets most. */
const COUNTRY_ZH = {
  DE: '德国', US: '美国', CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾',
  JP: '日本', KR: '韩国', GB: '英国', FR: '法国', IT: '意大利', ES: '西班牙',
  NL: '荷兰', CH: '瑞士', SE: '瑞典', NO: '挪威', DK: '丹麦', FI: '芬兰',
  AT: '奥地利', BE: '比利时', PL: '波兰', CZ: '捷克', PT: '葡萄牙', GR: '希腊',
  IE: '爱尔兰', LU: '卢森堡', HU: '匈牙利', RO: '罗马尼亚', SK: '斯洛伐克',
  SG: '新加坡', VN: '越南', TH: '泰国', MY: '马来西亚', ID: '印尼', PH: '菲律宾',
  IN: '印度', BD: '孟加拉国', PK: '巴基斯坦', AE: '阿联酋', SA: '沙特', IL: '以色列',
  TR: '土耳其', RU: '俄罗斯', UA: '乌克兰', KZ: '哈萨克斯坦',
  AU: '澳大利亚', NZ: '新西兰', CA: '加拿大', MX: '墨西哥', BR: '巴西', CL: '智利',
  AR: '阿根廷', ZA: '南非', EG: '埃及', NG: '尼日利亚', MA: '摩洛哥',
  KY: '开曼群岛', VG: '英属维尔京群岛', BM: '百慕大', PA: '巴拿马', SC: '塞舌尔',
  BS: '巴哈马', JE: '泽西岛', GG: '根西岛', IM: '马恩岛', AI: '安圭拉',
  CW: '库拉索', MH: '马绍尔群岛', BZ: '伯利兹', LI: '列支敦士登', MT: '马耳他',
  CY: '塞浦路斯',
}

/** Render a country code for a Chinese reader, falling back to the raw code. */
export function countryName(code) {
  if (!code) return '未知'
  return COUNTRY_ZH[code] ?? code
}
