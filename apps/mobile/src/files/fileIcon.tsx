import { memo } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import {
  fileIconName,
  themedFileIconName,
  type FileIconName,
} from '../../../../src/shared/fileIcons';
import { FILE_ICON_SVGS } from './fileIconSvgs.generated';

/**
 * 文件树与 iPad 标签条的类型图标：material-icon-theme（MIT）彩色 SVG 子集。
 * 用户拍板 2026-10-13：Mac、iPhone、iPad 三端统一为同一套彩色类型图标（AGENTS.md §5.7 例外）。
 * 后缀/文件名映射来自 src/shared/fileIcons.ts，SVG 字符串由
 * scripts/build-mobile-file-icons.mjs 生成。
 */

type FileIconSvgName = keyof typeof FILE_ICON_SVGS;

export function fileIconFor(name: string, dir: boolean, expanded: boolean): FileIconName {
  return fileIconName(name, dir, expanded);
}

function svgFor(icon: FileIconName, theme: 'light' | 'dark'): string {
  const themed = themedFileIconName(icon, theme);
  return FILE_ICON_SVGS[(themed in FILE_ICON_SVGS ? themed : icon) as FileIconSvgName];
}

export const FileIcon = memo(function FileIcon({ name, dir, expanded, size, theme }: {
  name: string;
  dir: boolean;
  expanded: boolean;
  size: number;
  theme: 'light' | 'dark';
}) {
  const icon = fileIconFor(name, dir, expanded);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size }}
      testID={`file-icon-${icon}`}
    >
      <SvgXml height={size} width={size} xml={svgFor(icon, theme)} />
    </View>
  );
});
