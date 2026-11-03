import { t } from '../i18n';

/** 已配对电脑在连接条与设置里的通用名；电脑端有 Mac 也有 Windows，不写死 Mac（2026-11-02）。 */
const COMPUTER = '电脑';
const SEPARATOR = ' · ';

/** 状态里保存的名字与语言无关（中文源串），显示时再经 `deviceDisplayName` 翻译。 */
export function pairedDeviceName(host: string): string {
  return `${COMPUTER}${SEPARATOR}${host}`;
}

/** 只改写本模块与「尚未绑定电脑」这两种固定形式，其余原样显示（与 panelDisplayLabel 同口径）。 */
export function deviceDisplayName(deviceName: string): string {
  if (deviceName === '尚未绑定电脑') return t(deviceName);
  const prefix = `${COMPUTER}${SEPARATOR}`;
  if (deviceName.startsWith(prefix)) return `${t(COMPUTER)}${SEPARATOR}${deviceName.slice(prefix.length)}`;
  return deviceName;
}
